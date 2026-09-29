import { VisuallyHidden } from "@mantine/core";
import { IconHistory, IconPlayerPlay } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import { closeScenarioSession, createScenarioSession, getScenarioRequest, getScenarioSession, isScenarioUnavailable, listMyScenarioSessions, listScenarioPacks, ScenarioHttpError, streamScenarioTurn,
	type ScenarioActionInput, type ScenarioArchiveRef, type ScenarioCloseRequest, type ScenarioErrorInfo, type ScenarioPackSummary, type ScenarioReport, type ScenarioSessionState, type ScenarioTurnRequest, type ScenarioTurnResult, type ScenarioView } from "@/api/scenario";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorMessage } from "@/utils/error";
import ActionBar, { type ScenarioIntent } from "./ActionBar";
import ScenarioReportView from "./ScenarioReportView";
import ScenarioSidePanel from "./ScenarioSidePanel";
import ScenarioStage from "./ScenarioStage";
import { sessionRowMeta } from "./sessions";
import type { PendingStudentLine } from "./stream";
import "./scenario.css";

const EMPTY_INTENT: ScenarioIntent = { kind: "speech", target: null };
type SavedRequest = { request: ScenarioTurnRequest; label: string; restoreText: string | null };

/** 冲突的处置方式不同，所以按语义分组，不按 HTTP 状态码分组（`docs/23` §8.1）。 */
/** 序号过期：刷新到最新处境后**同一个请求身份**可以重发（提交只会成功一次）。 */
const SEQUENCE_CONFLICTS = ["session_conflict"];
/** 会话已不可写：刷新后转只读，不再提供重发。 */
const READONLY_CODES = ["session_closed", "session_archived"];
/** 请求自身不一致（目标/动作/选项）：改完输入要**换新身份**，同 id 只会再被拒。 */
const SHAPE_CODES = [
	"unknown_target",
	"target_mismatch",
	"unknown_affordance",
	"invalid_selection",
	"schema_unsupported",
];

/** 结局词：被阻止/未建模**不是**临床错误，措辞不能让学生以为自己做错了什么。 */
function outcomeAnnouncement(result: ScenarioTurnResult): string {
	switch (result.outcome) {
		case "blocked":
			return `这次行动没有被执行，原因已给出（时间单位 ${result.turn}）。`;
		case "unmodeled":
			return `这类尝试目前还不能模拟临床后果（时间单位 ${result.turn}）。`;
		case "clarification":
			return "需要补充信息，本次行动还没有执行。";
		case "hint":
			return "提示已给出，情境时间没有推进。";
		default:
			return result.time_cost > 0 ? `时间前进了 ${result.time_cost} 个单位，世界给出了新的回应。` : `世界的回应已到，时间没有前进（时间单位 ${result.turn}）。`;
	}
}

export default function ScenarioConsole() {
	const [searchParams, setSearchParams] = useSearchParams();
	const urlId = searchParams.get("session");
	const [view, setView] = useState<ScenarioView | null>(null);
	const [report, setReport] = useState<ScenarioReport | null>(null);
	const [legacyReport, setLegacyReport] = useState<Record<string, unknown> | null>(null);
	const [archive, setArchive] = useState<ScenarioArchiveRef | null>(null);
	const [readOnly, setReadOnly] = useState(false);
	const [reportOpen, setReportOpen] = useState(false);
	const [opening, setOpening] = useState(false);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [phase, setPhase] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [uncertain, setUncertain] = useState(false);
	const [retry, setRetry] = useState<SavedRequest | null>(null);
	const [pending, setPending] = useState<PendingStudentLine | null>(null);
	const [freeText, setFreeText] = useState("");
	const [intent, setIntent] = useState<ScenarioIntent>(EMPTY_INTENT);
	const [openAffordanceId, setOpenAffordanceId] = useState<string | null>(null);
	const [sideOpen, setSideOpen] = useState(false);
	const [historyExpanded, setHistoryExpanded] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	const [hintText, setHintText] = useState<string | null>(null);
	const [highlightTurn, setHighlightTurn] = useState<number | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const loadedIdRef = useRef<number | null>(null);
	const closeRequestRef = useRef<ScenarioCloseRequest | null>(null);
	const sideToggleRef = useRef<HTMLButtonElement>(null);
	const { confirm } = useConfirm();
	const packsQuery = useQuery({ queryKey: queryKeys.scenario.packs(), queryFn: listScenarioPacks, retry: false });
	const historyQuery = useQuery({ queryKey: queryKeys.scenario.mySessions(), queryFn: listMyScenarioSessions, retry: false });

	/** 会话状态（`GET /sessions/{id}` 或刷新后的重取）落到界面：报告、只读与归档都只认服务端。 */
	function applySessionState(state: ScenarioSessionState) {
		setView(state.view);
		setReport(state.report ?? null);
		setLegacyReport(state.legacy_report ?? null);
		setArchive(state.archive ?? null);
		setReadOnly(state.read_only || state.view.session.read_only);
	}

	// 草稿与未决的请求身份在刷新或离开训练页之后仍然有效。
	//
	// 只按 `loadedIdRef` 判断"已经装过"，**不**用 effect 清理函数里的 cancelled 标记：
	// StrictMode 下 effect 会跑两次（第一次立即被清理），用 cancelled 会让第一次那一发
	// 请求的结果被丢掉、第二次又因为"已装过"提前返回——训练页永远停在读取中（实测）。
	// 状态是否该落地，只取决于**当前装的是不是这个会话**。
	useEffect(() => {
		const id = urlId && /^\d+$/.test(urlId) ? Number(urlId) : null;
		if (id === loadedIdRef.current) return;
		abortRef.current?.abort();
		loadedIdRef.current = id;
		setView(null); setReport(null); setLegacyReport(null); setArchive(null); setReadOnly(false);
		setReportOpen(false); setError(null); setPending(null); setRetry(null); setUncertain(false); setSideOpen(false);
		setFreeText(""); setIntent(EMPTY_INTENT); setOpenAffordanceId(null); setHintText(null); setHighlightTurn(null);
		setPhase(null);
		busyRef.current = false; setBusy(false);
		if (id === null) return;
		const stale = () => loadedIdRef.current !== id;
		setOpening(true);
		getScenarioSession(id).then((data) => {
			if (stale()) return;
			applySessionState(data);
			try {
				const draft = JSON.parse(sessionStorage.getItem(`scenario-draft:${id}`) ?? "null");
				if (draft) { setFreeText(draft.text); setIntent(draft.intent); }
				const saved = JSON.parse(sessionStorage.getItem(`scenario-request:${id}`) ?? "null") as SavedRequest | null;
				if (saved) { setRetry(saved); setUncertain(true); setPhase("receiving"); void recover(id, saved); }
			} catch { /* Storage may be unavailable; the committed server view remains authoritative. */ }
		}).catch((err) => { if (!stale()) setError(getApiErrorMessage(err, "读取情境失败")); }).finally(() => { if (!stale()) setOpening(false); });
	}, [urlId]);
	useEffect(() => {
		if (view && loadedIdRef.current === view.session.id) {
			try { sessionStorage.setItem(`scenario-draft:${view.session.id}`, JSON.stringify({ text: freeText, intent })); } catch { /* Optional browser storage. */ }
		}
	}, [freeText, intent, view]);
	useEffect(() => () => abortRef.current?.abort(), []);
	useEffect(() => {
		if (!sideOpen) return;
		const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setSideOpen(false); sideToggleRef.current?.focus(); } };
		document.addEventListener("keydown", close);
		return () => document.removeEventListener("keydown", close);
	}, [sideOpen]);
	// 应用外壳保持不动；只有训练面跟随手机键盘（双滚动陷阱见 `docs/23` §7.8）。
	useEffect(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		const resize = () => document.documentElement.style.setProperty("--sc-keyboard-inset", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
		viewport.addEventListener("resize", resize); resize();
		return () => { viewport.removeEventListener("resize", resize); document.documentElement.style.removeProperty("--sc-keyboard-inset"); };
	}, []);

	function rememberRequest(id: number, saved: SavedRequest | null) {
		try { if (saved) sessionStorage.setItem(`scenario-request:${id}`, JSON.stringify(saved)); else sessionStorage.removeItem(`scenario-request:${id}`); } catch { /* Requests still retain their identity in memory. */ }
	}
	function applyResult(result: ScenarioTurnResult, saved: SavedRequest) {
		setView(result.view); setPending(null); setRetry(null); setUncertain(false); setError(null); setPhase(null);
		// 纯交流不推进时间：没有时间前进就没有"世界变了"可突出（不看提交次数）。
		setHighlightTurn(result.time_cost > 0 ? result.turn : null);
		rememberRequest(result.view.session.id, null);
		if (saved.restoreText !== null) setFreeText((current) => current === saved.restoreText ? "" : current);
		if (result.outcome === "hint") setHintText((result.messages ?? []).filter((message) => message.kind === "hint").map((message) => message.text).join("\n"));
		if (result.outcome !== "clarification") setOpenAffordanceId(null);
		setAnnouncement(outcomeAnnouncement(result));
	}
	/** 提交前失败：世界没动，输入与请求身份都留着（同 id 重试恒安全）。 */
	function failBeforeCommit(info: ScenarioErrorInfo, saved: SavedRequest) {
		setPending(null); setUncertain(false); setRetry(saved); setPhase(null);
		setError(`${info.message} 本次未提交，原输入已保留。`);
		if (saved.restoreText !== null) setFreeText((current) => current || saved.restoreText!);
	}
	/** 重试用**当前**序号：过期序号会先被 409 挡住，刷新后拿到的 seq 才是可提交的基线。 */
	async function send(saved: SavedRequest) {
		const current = view;
		if (!current || busyRef.current) return;
		const id = current.session.id;
		const request: ScenarioTurnRequest = { ...saved.request, expected_seq: current.session.seq };
		const resend = { ...saved, request };
		busyRef.current = true; setBusy(true); setError(null); setUncertain(false); setRetry(resend); setPhase("receiving");
		rememberRequest(id, resend);
		if (request.kind !== "hint") setPending({ requestId: request.request_id, kind: request.kind, text: request.text ?? resend.label, target: request.target ?? null });
		const controller = new AbortController(); abortRef.current = controller;
		let settled = false;
		try {
			await streamScenarioTurn(id, request, (event) => {
				if (loadedIdRef.current !== id || event.request_id !== request.request_id) return;
				if (event.kind === "phase") setPhase(event.phase);
				else if (event.kind === "committed") { settled = true; applyResult(event.result, resend); }
				else if (event.kind === "error") { settled = true; void handleFailure(event.error, resend, id); }
				// delivery 是**已校验但未提交**的草稿：不进学生的世界，也不当事实展示。
			}, controller.signal);
			if (!settled && !controller.signal.aborted) await recover(id, resend);
		} catch (err) {
			if (!controller.signal.aborted && loadedIdRef.current === id) {
				if (err instanceof ScenarioHttpError) await handleFailure(err.detail, resend, id);
				else await recover(id, resend);
			}
		} finally { if (loadedIdRef.current === id) { busyRef.current = false; setBusy(false); } abortRef.current = null; }
	}
	/**
	 * 断流恢复：**先查结果再决定重发**（`GET /sessions/{id}/requests/{request_id}`）。
	 * `unknown` 只说明"没有已提交记录、结果未明"，不等于失败，也绝不为同一次尝试换新 id。
	 */
	async function recover(id: number, saved: SavedRequest) {
		busyRef.current = true; setBusy(true); setPhase("receiving"); setUncertain(true);
		try {
			const lookup = await getScenarioRequest(id, saved.request.request_id);
			if (loadedIdRef.current !== id) return;
			if (lookup.state === "committed" && lookup.result) applyResult(lookup.result, saved);
			else if (lookup.state === "failed" && lookup.error) failBeforeCommit(lookup.error, saved);
			else { setRetry(saved); setError("连接中断，本次结果仍未确认。可查询结果，或用同一请求重新连接；不会重复执行。"); }
		} catch { if (loadedIdRef.current === id) { setRetry(saved); setError("暂时无法确认本次结果，请恢复网络后查询。原请求和输入已保留。"); } }
		finally { busyRef.current = false; setBusy(false); }
	}
	async function handleFailure(info: ScenarioErrorInfo, saved: SavedRequest, id: number) {
		if (SEQUENCE_CONFLICTS.includes(info.code)) {
			const data = await getScenarioSession(id);
			if (loadedIdRef.current !== id) return;
			applySessionState(data);
			setPending(null); setPhase(null); setUncertain(false); setRetry(saved);
			setError(`${info.message} 已刷新到最新处境（时间单位 ${data.view.session.turn}）。你的输入还在，可再次发送。`);
			return;
		}
		if (READONLY_CODES.includes(info.code)) {
			const data = await getScenarioSession(id);
			if (loadedIdRef.current !== id) return;
			applySessionState(data);
			setPending(null); setPhase(null); setUncertain(false); setRetry(null);
			rememberRequest(id, null);
			setError(info.message);
			return;
		}
		if (info.code === "request_conflict") {
			// 同 id 不同输入：留着输入，但**必须换新身份**再做一次（docs/23 §8.1）。
			setPending(null); setPhase(null); setUncertain(false); setRetry(null);
			rememberRequest(id, null);
			setError("这次尝试与同一请求身份的原内容不一致，本次没有提交。输入已保留，重新发送会作为一次新的尝试。");
			return;
		}
		if (SHAPE_CODES.includes(info.code)) {
			setPending(null); setPhase(null); setUncertain(false); setRetry(null);
			rememberRequest(id, null);
			// 目标/动作被拒：把对象退回"未选择"，让学生自己重选，不静默换人。
			if (info.code === "unknown_target" || info.code === "target_mismatch") setIntent((current) => ({ ...current, target: null }));
			if (info.code === "unknown_affordance" || info.code === "invalid_selection") setOpenAffordanceId(null);
			setError(`${info.message} 本次未提交，输入已保留。`);
			return;
		}
		failBeforeCommit(info, saved);
	}
	async function submitAction(action: ScenarioActionInput) {
		if (!view || readOnly || busyRef.current || uncertain) return;
		const affordances = view.affordances ?? [];
		const affordance = action.affordance_id ? affordances.find((item) => item.id === action.affordance_id) : undefined;
		if (affordance?.confirm && !await confirm({ title: affordance.label, message: "这个动作不可逆。", confirmLabel: "确认尝试", danger: true })) return;
		const request: ScenarioTurnRequest = { ...action, request_id: crypto.randomUUID(), expected_seq: view.session.seq };
		const typed = action.affordance_id !== undefined || action.kind === "hint";
		setHighlightTurn(null);
		await send({ request, label: affordance?.label ?? (action.kind === "hint" ? "请求一点提示" : ""), restoreText: typed ? null : action.text ?? null });
	}
	async function start(pack: ScenarioPackSummary) {
		if (busyRef.current) return;
		busyRef.current = true; setBusy(true); setOpening(true); setError(null);
		try { const data = await createScenarioSession({ pack_key: pack.key, revision_id: pack.revision_id, trial: false }); setSearchParams({ session: String(data.session_id) }); void historyQuery.refetch(); }
		catch (err) { setError(getApiErrorMessage(err, "开启情境失败")); }
		finally { busyRef.current = false; setBusy(false); setOpening(false); }
	}
	/** 结束请求与在途动作按同一序号串行提交；响应丢失时用**同一个身份**查回来，不重开一次。 */
	async function close() {
		if (!view || busyRef.current || uncertain || readOnly) return;
		if (!closeRequestRef.current && !await confirm({ title: "结束本次情境？", message: "结束后只能回看，不能继续这一局。若只想离开，可从应用导航退出，稍后继续。", confirmLabel: "结束本次", danger: true })) return;
		busyRef.current = true; setBusy(true);
		const request = closeRequestRef.current ?? { request_id: crypto.randomUUID(), expected_seq: view.session.seq };
		closeRequestRef.current = request;
		try {
			const data = await closeScenarioSession(view.session.id, request);
			setView(data.view); setReport(data.report); setLegacyReport(null); setReadOnly(data.view.session.read_only); setReportOpen(true);
			closeRequestRef.current = null; setError(null); void historyQuery.refetch();
		} catch {
			try {
				const lookup = await getScenarioRequest(view.session.id, request.request_id);
				if (lookup.kind === "close" && lookup.state === "committed" && lookup.close_result) {
					const data = lookup.close_result;
					setView(data.view); setReport(data.report); setLegacyReport(null); setReadOnly(data.view.session.read_only); setReportOpen(true);
					closeRequestRef.current = null; setError(null); void historyQuery.refetch();
				} else if (lookup.state === "failed" && lookup.error) {
					closeRequestRef.current = null;
					setError(`${lookup.error.message} 这一局还没有结束，可以再次点击「结束本次」。`);
				} else {
					setError("正在确认本次结束的结果；确认前不会再提交新的行动。");
				}
			} catch { setError("暂时无法确认结束结果，请恢复连接后重试。"); }
		} finally { busyRef.current = false; setBusy(false); }
	}
	const leave = () => { abortRef.current?.abort(); setSearchParams({}); void historyQuery.refetch(); };
	const closeSide = () => { setSideOpen(false); sideToggleRef.current?.focus(); };
	/** 资料栏里的时间单位回到对话流那一段（变化可追溯到来源时间点）。 */
	const locateTurn = (turn: number) => {
		document.getElementById(`sc-turn-${turn}`)?.scrollIntoView({ block: "start" });
	};
	if (isScenarioUnavailable(packsQuery.error)) return <div className="sc-root"><div className="sc-gate">情境训练当前未开启</div></div>;
	if (view && (report !== null || legacyReport !== null) && reportOpen) return <div className="sc-root" data-view="report"><ScenarioReportView report={report} legacyReport={legacyReport} view={view} actions={<><button type="button" className="sc-btn" onClick={() => setReportOpen(false)}>回看对话</button><button type="button" className="sc-btn" onClick={() => { const pack = packsQuery.data?.find((item) => item.key === view.pack.key); if (pack) void start(pack); }} disabled={busy}>再练一次</button><button type="button" className="sc-btn" onClick={leave}>返回场景列表</button></>} /></div>;
	if (!view) return <div className="sc-root" data-view="open"><div className="sc-gate sc-gate-wide"><section className="sc-open" aria-label="情境训练">
		<h2 className="sc-open-title">选一个情境开始</h2>
		{(opening || packsQuery.isLoading) && <div role="status">正在读取情境…</div>}
		{error && <div className="sc-error" role="alert">{error}<button type="button" className="sc-btn" onClick={leave}>回到场景列表</button></div>}
		{packsQuery.error && <div className="sc-error" role="alert">情境列表读取失败<button type="button" className="sc-btn" onClick={() => packsQuery.refetch()}>重试</button></div>}
		<div className="sc-packs">{packsQuery.data?.map((pack) => <article className="sc-pack" key={pack.key}><div className="sc-pack-head"><h3 className="sc-pack-title">{pack.title}</h3><p className="sc-pack-one-line">{pack.one_line}</p></div><div className="sc-pack-badges">{[pack.player_role, pack.place].filter(Boolean).map((text) => <span className="sc-badge" key={text}>{text}</span>)}</div><div className="sc-pack-actions"><button type="button" className="sc-btn sc-btn-lg sc-pack-start" disabled={busy || pack.revision_id === null} aria-label={`开始「${pack.title}」`} onClick={() => start(pack)}><IconPlayerPlay size={14} aria-hidden="true" />开始</button></div></article>)}</div>
		<section className="sc-history" aria-label="我的情境经历"><div className="sc-section-head"><IconHistory size={16} aria-hidden="true" /><span>我的情境经历</span></div>{historyQuery.isError && <button type="button" className="sc-btn" onClick={() => historyQuery.refetch()}>经历读取失败，重试</button>}<div className="sc-history-list">{(historyExpanded ? historyQuery.data : historyQuery.data?.slice(0, 8))?.map((row) => <button type="button" key={row.id} className="sc-history-item" disabled={busy} onClick={() => setSearchParams({ session: String(row.id) })}><span className="sc-history-title">{row.pack_title}</span><span className="sc-history-meta">{row.read_only ? "机制切换 · 仅可回看" : sessionRowMeta(row)}</span></button>)}</div>{(historyQuery.data?.length ?? 0) > 8 && <button type="button" className="sc-ghost-btn" onClick={() => setHistoryExpanded((value) => !value)}>{historyExpanded ? "收起" : "查看全部经历"}</button>}</section>
	</section></div></div>;
	const finished = view.session.status !== "active";
	const locked = readOnly || finished;
	const reportAvailable = report !== null || legacyReport !== null;
	const archiveNote = archive === null ? null : `已归档（形状 v${archive.shape_version}${archive.ended_reason !== "" ? ` · ${archive.ended_reason}` : ""}）`;
	return <div className="sc-root" data-view="session" data-lost={view.session.lost}>
		<div className="sc-topbar"><span className="sc-topbar-title" title={view.pack.title}>{view.pack.title}</span><span className="sc-topbar-meta">{view.session.trial ? "试跑 · " : ""}{view.session.turn === 0 ? "时间未前进" : `已过 ${view.session.turn} 个时间单位`}</span><span className="sc-topbar-end"><button ref={sideToggleRef} type="button" className="sc-btn" aria-expanded={sideOpen} onClick={() => setSideOpen((value) => !value)}>资料／回看</button>{!locked && <button type="button" className="sc-ghost-btn" disabled={busy || uncertain} onClick={close}>结束本次</button>}</span></div>
		{locked && <div className="sc-note">{archive !== null ? "机制切换，旧局仅可回看" : finished ? "本次情境已结束" : "本局只能回看"}；已有记录保留。{archiveNote !== null && ` ${archiveNote}。`}{reportAvailable && <button type="button" className="sc-btn" onClick={() => setReportOpen(true)}>查看复盘</button>}<button type="button" className="sc-btn" onClick={leave}>返回列表</button></div>}
		<VisuallyHidden role="status" aria-live="polite">{announcement}</VisuallyHidden>
		<div className="sc-main"><div className="sc-column">
			<ScenarioStage view={view} pending={pending} phase={busy ? phase : null} highlightTurn={highlightTurn} onLocateTurn={locateTurn} actorStrip="unaddressable" showResources />
			{error && <div className="sc-stream-error" role="alert"><span>{error}</span>{retry && <>{uncertain && <button type="button" className="sc-btn" disabled={busy} onClick={() => recover(view.session.id, retry)}>查询本次结果</button>}{!locked && <button type="button" className="sc-btn" disabled={busy} onClick={() => send(retry)}>{uncertain ? "用原请求重新连接" : "重试本次"}</button>}</>}</div>}
			{hintText && <details className="sc-hint" open><summary>本次提示（不推进情境时间）</summary><p>{hintText}</p><button type="button" className="sc-btn" onClick={() => setFreeText(hintText)}>填入草稿，再自行修改</button></details>}
			{!locked && <ActionBar view={view} busy={busy || uncertain} freeText={freeText} onFreeTextChange={setFreeText} intent={intent} onIntentChange={setIntent} onSubmit={submitAction} openAffordance={(view.affordances ?? []).find((item) => item.id === openAffordanceId) ?? null} onOpenForm={setOpenAffordanceId} onCloseForm={() => setOpenAffordanceId(null)} onHint={() => submitAction({ kind: "hint", text: "请给我一点方向性提示", target: null, selection: [] })} />}
		</div><ScenarioSidePanel view={view} open={sideOpen} onClose={closeSide} onLocateTurn={locateTurn} /></div>
		{sideOpen && <button type="button" className="sc-sheet-backdrop" aria-label="收起资料面板" tabIndex={-1} onClick={closeSide} />}
	</div>;
}
