import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useEffect, useRef, useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
	type ScenarioActionInput,
	type ScenarioActor,
	type ScenarioPackSummary,
	type ScenarioReport,
	type ScenarioView,
	ScenarioHttpError,
	ScenarioStreamUnavailable,
	closeScenarioSession,
	createScenarioSession,
	getScenarioSession,
	isScenarioUnavailable,
	listMyScenarioSessions,
	listScenarioPacks,
	postScenarioAction,
	streamScenarioAction,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { formatShortDateTime } from "@/utils/date";
import { getApiErrorMessage } from "@/utils/error";
import ActionBar from "./ActionBar";
import ScenarioReportView from "./ScenarioReportView";
import ScenarioSidePanel from "./ScenarioSidePanel";
import ScenarioStage from "./ScenarioStage";
import { talkPrefill } from "./actors";
import { studentFallbackNotice } from "./problems";
import { type ScenarioStreamDraft, draftView, mergeBlocks } from "./stream";
import "./scenario.css";
import { sessionRowMeta } from "./sessions";

/**
 * 情境训练（实验特性）· 学生侧 —— 隐藏路由 `/scenario`，不出现在导航。
 *
 * 数据只有一份来源：后端的 `view` / `report` 投影。页面不自己算分数、不自己编文案，
 * 也不预置"其他/自输入"之外的建议（DM 的 `options` 才是建议）。
 * 原始诊断串（`dm_parse:*` 等）**不进这里**，学生只看到"这一回合是不是保底生成的"。
 *
 * 开关关闭时整个 `/api/scenario/**` 返回 **404**，因此 404 一律按"实验特性未开启"呈现：
 * 不区分"会话不属于我"，也不暴露实验面。
 */
export default function ScenarioConsole() {
	const [sessionId, setSessionId] = useState<number | null>(null);
	const [view, setView] = useState<ScenarioView | null>(null);
	const [report, setReport] = useState<ScenarioReport | null>(null);
	const [featureOff, setFeatureOff] = useState(false);
	/** 会话已被结算（409）：动作被拒，但仍可读经历。 */
	const [ended, setEnded] = useState(false);
	/** 流式草稿：已写完但还没落地的块（权威 view 一到就丢）。 */
	const [draft, setDraft] = useState<ScenarioStreamDraft | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [streamFailed, setStreamFailed] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const lastActionRef = useRef<ScenarioActionInput | null>(null);
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [freeText, setFreeText] = useState("");
	const [freeOpen, setFreeOpen] = useState(false);

	const packsQuery = useQuery({
		queryKey: queryKeys.scenario.packs(),
		queryFn: listScenarioPacks,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const historyQuery = useQuery({
		queryKey: queryKeys.scenario.mySessions(),
		queryFn: listMyScenarioSessions,
		retry: false,
	});

	// 404 是"实验特性未开启"这一种事实；其余错误照旧走 getApiErrorMessage/toast 约定
	const absorbError = (err: unknown, fallback: string): string | null => {
		if (isScenarioUnavailable(err)) {
			setFeatureOff(true);
			return null;
		}
		if (isAxiosError(err) && err.response?.status === 409) {
			setEnded(true);
			return "这次情境已经结束了，不能再做新的动作。可以看经历。";
		}
		return getApiErrorMessage(err, fallback);
	};

	const start = async (pack: ScenarioPackSummary) => {
		setBusy(true);
		setActionError(null);
		try {
			const data = await createScenarioSession({
				pack_key: pack.key,
				revision_id: pack.revision_id,
			});
			setSessionId(data.session_id);
			setView(data.view);
			setReport(null);
			setEnded(false);
			// 新一局不许带上一局的残留：草稿与"流式中断"提示都清掉
			setDraft(null);
			setStreamFailed(null);
			setFreeText("");
			setFreeOpen(false);
			historyQuery.refetch();
		} catch (err) {
			const message = absorbError(err, "开启情境失败");
			if (message) toast.error(message);
		} finally {
			setBusy(false);
		}
	};

	/** 回到某次经历：`active` 继续做，`completed` 直接看结算（后端两件事同一个读口）。 */
	const resume = async (row: { id: number }) => {
		setBusy(true);
		setActionError(null);
		try {
			const data = await getScenarioSession(row.id);
			setSessionId(data.session_id);
			setView(data.view);
			setReport(data.report);
			setEnded(data.status !== "active");
			setDraft(null);
			setStreamFailed(null);
			setFreeText("");
			setFreeOpen(false);
		} catch (err) {
			const message = absorbError(err, "读取这次情境失败");
			if (message) toast.error(message);
		} finally {
			setBusy(false);
		}
	};

	/** 非流式那条路：行为与今天完全一致（流式不可用时的兜底，也是重试的最后手段）。 */
	const submitPlain = async (sessionId: number, action: ScenarioActionInput) => {
		const data = await postScenarioAction(sessionId, action);
		setView(data.view);
		setDraft(null);
		setFreeText("");
		setFreeOpen(false);
	};

	const submit = async (action: ScenarioActionInput) => {
		if (sessionId === null || busy) return;
		lastActionRef.current = action;
		setBusy(true);
		setActionError(null);
		setStreamFailed(null);
		setDraft(null);
		setStreaming(true);
		const controller = new AbortController();
		abortRef.current = controller;
		let settled = false;
		try {
			await streamScenarioAction(
				sessionId,
				action,
				(event) => {
					if (event.kind === "blocks") {
						// 增量：叙述/台词写完就渲染，不等整回合
						setDraft((current) => mergeBlocks(current ?? {}, event.blocks));
						return;
					}
					if (event.kind === "view") {
						// 权威结果：它覆盖一切（草稿丢掉）
						settled = true;
						setView(event.view);
						setDraft(null);
						setFreeText("");
						setFreeOpen(false);
						return;
					}
					// error：保留已渲染的内容，给重试入口
					settled = true;
					setStreamFailed(event.message);
				},
				controller.signal,
			);
			if (!settled) setStreamFailed("本回合没有拿到完整结果，可以重试。");
		} catch (err) {
			if (err instanceof ScenarioStreamUnavailable) {
				// 流式这条路走不通 → 自动退回非流式（不得比今天更差）
				try {
					await submitPlain(sessionId, action);
				} catch (fallbackErr) {
					const message = absorbError(fallbackErr, "提交动作失败");
					if (message) setActionError(message);
				}
			} else if (err instanceof ScenarioHttpError) {
				const message = absorbError(
					{ isAxiosError: true, response: { status: err.status, data: { detail: err.detail } } },
					"提交动作失败",
				);
				if (message) setActionError(message);
			} else if (!controller.signal.aborted) {
				const message = absorbError(err, "提交动作失败");
				if (message) setActionError(message);
			}
		} finally {
			abortRef.current = null;
			setStreaming(false);
			setBusy(false);
		}
	};

	// 卸载/离开页时中断在途的流（不留悬空连接，也不在卸载后 setState）
	useEffect(
		() => () => {
			abortRef.current?.abort();
		},
		[],
	);

	const close = async () => {
		if (sessionId === null || busy) return;
		setBusy(true);
		setActionError(null);
		try {
			const data = await closeScenarioSession(sessionId);
			setView(data.view);
			setReport(data.report);
			historyQuery.refetch();
		} catch (err) {
			const message = absorbError(err, "结算失败");
			if (message) toast.error(message);
		} finally {
			setBusy(false);
		}
	};

	const leaveSession = () => {
		setSessionId(null);
		setView(null);
		setReport(null);
		setEnded(false);
		setActionError(null);
		setDraft(null);
		setStreamFailed(null);
		historyQuery.refetch();
	};

	/** 点在场者 = 搭话；不在场但叫得来人走同一条自由通道（预填，不替学生说话）。 */
	const talkTo = (actor: ScenarioActor) => {
		if (!view || view.free_input === false) return;
		setFreeOpen(true);
		setFreeText(talkPrefill(actor.role, actor.presence));
	};

	if (featureOff || (packsQuery.error && isScenarioUnavailable(packsQuery.error))) {
		return (
			<div className="sc-root">
				<div className="sc-gate">
					<div className="sc-gate-title">情境训练实验特性未开启</div>
					<div className="sc-gate-body">
						这是一个未公开的实验特性：服务端关闭时整个
						<code className="sc-gate-mono"> /api/scenario/** </code>
						命名空间不可用（404）。开启与否由部署方决定，页面不提供开关。
					</div>
				</div>
			</div>
		);
	}

	if (packsQuery.isLoading) {
		return (
			<div className="sc-root">
				<div className="sc-gate">
					<div className="sc-gate-body">正在读取可用情境…</div>
				</div>
			</div>
		);
	}

	if (packsQuery.error) {
		return (
			<div className="sc-root">
				<div className="sc-gate">
					<div className="sc-gate-title">情境列表读取失败</div>
					<div className="sc-gate-body">
						{getApiErrorMessage(packsQuery.error, "请稍后重试")}
					</div>
					<button
						type="button"
						className="sc-btn"
						onClick={() => packsQuery.refetch()}
					>
						重试
					</button>
				</div>
			</div>
		);
	}

	const packs = packsQuery.data ?? [];
	const history = historyQuery.data ?? [];

	if (report && view) {
		return (
			<div className="sc-root" data-lost={report.lost}>
				<div className="sc-topbar">
					<span className="sc-topbar-title">{report.pack.title}</span>
					<span className="sc-topbar-meta">
						<span>已结算</span>
						<button type="button" className="sc-btn" onClick={leaveSession}>
							回到我的情境
						</button>
					</span>
				</div>
				<ScenarioReportView
					report={report}
					view={view}
					actions={
						<button type="button" className="sc-btn" onClick={leaveSession}>
							再挑一个情境
						</button>
					}
				/>
			</div>
		);
	}

	// 渲染用视图：权威视图叠加"已经写完的块"（草稿），权威 view 一到草稿即被丢弃
	const shownView = view === null ? null : draftView(view, draft);
	const fallbackNotice = shownView
		? studentFallbackNotice(shownView.problems)
		: null;

	return (
		<div className="sc-root" data-lost={view?.session.lost ?? false}>
			{shownView === null ? (
				<div className="sc-gate sc-gate-wide">
					<div className="sc-open">
						<div className="sc-gate-title">情境训练</div>
						<div className="sc-open-lead">
							挑一个情境，进去以后世界会自己往前走：你说的话、做的事都会被看见。
							这里没有标准答案按键，也没有分数——只有你经历过的判断。
						</div>
						{packs.length === 0 ? (
							<div className="sc-gate-body">还没有可用的情境包。</div>
						) : (
							<div className="sc-packs">
								{packs.map((pack) => (
									<button
										key={pack.key}
										type="button"
										className="sc-pack"
										disabled={busy}
										onClick={() => start(pack)}
									>
										<span className="sc-pack-title">{pack.title}</span>
										<span className="sc-pack-meta">
											<span className="sc-tag">{pack.state}</span>
											<span>修订 {pack.revision_no ?? "—"}</span>
										</span>
										<span className="sc-pack-one-line">{pack.one_line}</span>
									</button>
								))}
							</div>
						)}

						<section className="sc-history" aria-label="我的情境经历">
							<div className="sc-panel-head">
								<span>我的情境经历</span>
								<span>{history.length} 次</span>
							</div>
							{historyQuery.isLoading ? (
								<div className="sc-empty">正在读取…</div>
							) : history.length === 0 ? (
								<div className="sc-empty">
									还没有情境经历。挑上面的一个情境开始吧。
								</div>
							) : (
								<div className="sc-history-list">
									{history.map((row) => (
										<button
											key={row.id}
											type="button"
											className="sc-history-item"
											data-status={row.status}
											disabled={busy}
											onClick={() => resume(row)}
										>
											<span className="sc-history-title">
												{row.pack_title}
											</span>
											<span className="sc-history-meta">
												{sessionRowMeta(row)}
											</span>
											<span className="sc-history-time">
												{formatShortDateTime(row.updated_at ?? row.created_at)}
											</span>
										</button>
									))}
								</div>
							)}
						</section>
					</div>
				</div>
			) : (
				<>
					{shownView.session.lost && (
						<div className="sc-lost-banner">
							<span>已达到不可逆结局</span>
							<span className="sc-report-sub">
								情境还在继续，但这个结局已经无法回头——可以继续做完，也可以直接结算。
							</span>
						</div>
					)}
					{ended && (
						<div className="sc-lost-banner" data-kind="ended">
							<span>这次情境已经结束</span>
							<span className="sc-lost-sub">
								{actionError ??
									"结算之后不能再做动作；可以看经历，也可以回到我的情境。"}
							</span>
							<button type="button" className="sc-btn" onClick={close}>
								看经历
							</button>
						</div>
					)}

					<div className="sc-topbar">
						<span className="sc-topbar-title">{shownView.pack.title}</span>
						<span className="sc-topbar-meta">
							<span>你扮演：{shownView.pack.player_role}</span>
							<span>第 {shownView.session.turn} 回合</span>
							<span>{shownView.session.status}</span>
							<button
								type="button"
								className="sc-ghost-btn"
								onClick={leaveSession}
							>
								我的情境
							</button>
							<button
								type="button"
								className="sc-btn"
								disabled={busy}
								onClick={close}
							>
								结束并看经历
							</button>
						</span>
					</div>

					<div className="sc-column">
						<ScenarioStage
							view={shownView}
							onTalkTo={talkTo}
							streaming={streaming}
						/>

						{streamFailed && (
							<div className="sc-stream-error" role="alert">
								<span>{streamFailed}</span>
								<button
									type="button"
									className="sc-btn"
									disabled={busy}
									onClick={() => {
										const last = lastActionRef.current;
										if (last) void submit(last);
									}}
								>
									重试
								</button>
							</div>
						)}

						{fallbackNotice && <div className="sc-note">{fallbackNotice}</div>}

						{shownView.nudges.length > 0 && (
							<div className="sc-nudges">
								{shownView.nudges.map((nudge) => (
									<div className="sc-nudge" key={nudge}>
										<span>{nudge}</span>
									</div>
								))}
							</div>
						)}

						{ended ? (
							<div className="sc-actions">
								<span className="sc-actions-title">这次情境已结束</span>
								<div className="sc-buttons">
									<button type="button" className="sc-btn" onClick={close}>
										看经历
									</button>
								</div>
							</div>
						) : (
							<ActionBar
								view={shownView}
								busy={busy}
								freeText={freeText}
								freeOpen={freeOpen}
								onFreeTextChange={setFreeText}
								onFreeOpenChange={setFreeOpen}
								onSubmit={submit}
								errorMessage={actionError}
							/>
						)}
					</div>

					<ScenarioSidePanel view={shownView} />
				</>
			)}
		</div>
	);
}

