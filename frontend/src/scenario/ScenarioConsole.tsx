import { VisuallyHidden } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import {
	closeScenarioSession,
	createScenarioSession,
	getScenarioSession,
	isScenarioUnavailable,
	listMyScenarioSessions,
	listScenarioPacks,
	postScenarioAction,
	type ScenarioActionInput,
	type ScenarioActor,
	ScenarioHttpError,
	type ScenarioOption,
	type ScenarioPackSummary,
	type ScenarioReport,
	ScenarioStreamUnavailable,
	type ScenarioView,
	streamScenarioAction,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorMessage } from "@/utils/error";
import ActionBar, { ScenarioOptionStrip } from "./ActionBar";
import { ScenarioProgress } from "./DimCard";
import { resolvePanels } from "./panels";
import { studentFallbackNotice } from "./problems";
import ScenarioReportView from "./ScenarioReportView";
import ScenarioSidePanel from "./ScenarioSidePanel";
import ScenarioStage from "./ScenarioStage";
import { draftView, mergeBlocks, type ScenarioStreamDraft } from "./stream";
import "./scenario.css";
import { sessionRowMeta } from "./sessions";

/**
 * 情境训练（正式特性，docs/20）· 学生侧 —— 路由 `/scenario`，学生侧栏/底部 Tab 的「情境」。
 *
 * 数据只有一份来源：后端的 `view` / `report` 投影。页面不自己算分数、不自己编文案，
 * 也不预置"其他/自输入"之外的建议（DM 的 `options` 才是建议）。
 * 原始诊断串（`dm_parse:*` 等）**一律不进学生界面**，也不给"这一回合是保底生成的"这类
 * 系统口吻说明：界面只说世界里发生的事（文案规范见 docs/20 §学生面文案）。
 *
 * 动作区只有两个出入口：气泡流末尾的 DM 选项条 + 底部输入条（"更多动作"展开才见全部
 * affordance）。**流程状态在本页**（`openAffordanceId`）：选项条与输入条是同一个流程的
 * 两个入口，状态放这里才不会两边各持一份。
 *
 * 开关关闭时整个 `/api/scenario/**` 返回 **404**，因此首次读 pack 列表的 404 一律按
 * "功能未开启"呈现：不区分"会话不属于我"，也不暴露内部结构。
 */
/**
 * 控制台自带的**最简顶栏**：情境页跑在沉浸壳（`PracticeShell`）里，系统顶栏与侧栏都不在，
 * 所以"我在哪、怎么出去、怎么结束"必须由这条栏给出。
 *
 * 左侧恒为返回（学生没有系统导航可点）；中间是病例名；右侧由各视图传入（回合/结束动作）。
 * 它是纯结构：动作与文案都由调用方给。
 */
function ConsoleTopbar({
	onBack,
	title,
	meta,
}: {
	onBack: () => void;
	title: string;
	meta?: ReactNode;
}) {
	return (
		<div className="sc-topbar">
			<button type="button" className="sc-back" onClick={onBack}>
				<IconArrowLeft size={14} aria-hidden="true" />
				返回
			</button>
			<span className="sc-topbar-title">{title}</span>
			{meta !== undefined && <span className="sc-topbar-meta">{meta}</span>}
		</div>
	);
}

export default function ScenarioConsole() {
	const [sessionId, setSessionId] = useState<number | null>(null);
	const [view, setView] = useState<ScenarioView | null>(null);
	const [report, setReport] = useState<ScenarioReport | null>(null);
	/** 打开/恢复会话期间的"正在开启"提示（后端在请求里先跑开场回合，可能好几秒）。 */
	const [opening, setOpening] = useState(false);
	/** 最近一次提交的自由文本：只有它才在回合落地时被清空（学生可能已经在打下一句）。 */
	const submittedTextRef = useRef<string | null>(null);
	/** 回合落地后把焦点送回自由通道（键盘用户不必每回合从头 Tab）。 */
	const [focusToken, setFocusToken] = useState(0);
	/** 给读屏的回合播报（回合号 + 最新一句旁白）。 */
	const [announcement, setAnnouncement] = useState("");
	/** 会话进路由查询串：刷新/后退/收藏/新标签都能回到同一局（`?session=123`）。 */
	const [searchParams, setSearchParams] = useSearchParams();
	const deepLinkDoneRef = useRef(false);
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
	/** 展开中的 affordance 表单（选项条与输入条共用同一份流程状态）。 */
	const [openAffordanceId, setOpenAffordanceId] = useState<string | null>(null);
	const { confirm } = useConfirm();
	const navigate = useNavigate();
	/**
	 * 返回 = 回到训练首页（`/training`），**不用** `navigate(-1)`：
	 * 情境页可以被深链（`?session=`）直接打开，也可能从收藏进来，`-1` 会退出应用或落到登录页；
	 * `/training` 是三种角色都有的落脚点，且是学生进情境前的一页。
	 */
	const goBack = () => navigate("/training");

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

	/**
	 * 把异常翻译成给人看的文案。
	 *
	 * **只有 `packsQuery` 的首次加载 404 才等于"特性未开启"**（下面 gate 的判据）；
	 * 动作/开启/恢复/结算的 404 是"这个包或这个会话没了"这种普通错误，
	 * 不能把整页换成无出口的 gate——那样学生连"重试"都没有。
	 */
	const absorbError = (err: unknown, fallback: string): string | null => {
		if (isAxiosError(err) && err.response?.status === 409) {
			setEnded(true);
			return "这次情境已经结束了，不能再做新的动作。可以看经历。";
		}
		return getApiErrorMessage(err, fallback);
	};

	/** 地址栏里的会话：是"这一局在哪"，不是权限——归属仍由后端 404 兜底。 */
	const rememberSession = (id: number | null) => {
		// 这是我们自己写进去的：深链恢复只服务于"刷新/直达"，
		// 否则刚开好一局就会被自己写下的参数又恢复一次（重复请求 + busy 卡住）
		deepLinkDoneRef.current = true;
		setSearchParams(id === null ? {} : { session: String(id) }, {
			replace: true,
		});
	};

	const start = async (pack: ScenarioPackSummary) => {
		setBusy(true);
		setOpening(true);
		setActionError(null);
		try {
			const data = await createScenarioSession({
				pack_key: pack.key,
				revision_id: pack.revision_id,
			});
			setSessionId(data.session_id);
			rememberSession(data.session_id);
			setView(data.view);
			setReport(null);
			setEnded(false);
			// 新一局不许带上一局的残留：草稿与"流式中断"提示都清掉
			setDraft(null);
			setStreamFailed(null);
			setFreeText("");
			historyQuery.refetch();
		} catch (err) {
			const message = absorbError(err, "开启情境失败");
			if (message) toast.error(message);
		} finally {
			setBusy(false);
			setOpening(false);
		}
	};

	/** 回到某次经历：`active` 继续做，`completed` 直接看结算（后端两件事同一个读口）。 */
	const resume = async (row: { id: number }) => {
		setBusy(true);
		setOpening(true);
		setActionError(null);
		try {
			const data = await getScenarioSession(row.id);
			setSessionId(data.session_id);
			rememberSession(data.session_id);
			setView(data.view);
			setReport(data.report);
			setEnded(data.status !== "active");
			setDraft(null);
			setStreamFailed(null);
			setFreeText("");
		} catch (err) {
			const message = absorbError(err, "读取这次情境失败");
			if (message) toast.error(message);
		} finally {
			setBusy(false);
			setOpening(false);
		}
	};

	/**
	 * 回合落地：视图换成权威结果，并处理两件"人"的事——
	 * 只在**刚提交的那份文本**没被改过时清空输入（H3），以及把焦点送回输入框并播报回合（M4）。
	 */
	const applyTurnResult = (nextView: ScenarioView) => {
		setView(nextView);
		setDraft(null);
		const submitted = submittedTextRef.current;
		// 学生可能已经在等的时候接着打字了：只有原样未改的那份才丢
		setFreeText((current) => (current === submitted ? "" : current));
		setFocusToken((token) => token + 1);
		const lastScene = [...nextView.messages]
			.reverse()
			.find((message) => message.role === "scene");
		setAnnouncement(
			`第 ${nextView.session.turn} 回合：${(lastScene?.text ?? "").slice(0, 60)}`,
		);
	};

	/** 非流式那条路：行为与今天完全一致（流式不可用时的兜底，也是重试的最后手段）。 */
	const submitPlain = async (sessionId: number, action: ScenarioActionInput) => {
		const data = await postScenarioAction(sessionId, action);
		applyTurnResult(data.view);
	};

	const submit = async (action: ScenarioActionInput) => {
		if (sessionId === null || busy) return;
		lastActionRef.current = action;
		submittedTextRef.current = action.text ?? null;
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
						applyTurnResult(event.view);
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

	// 直达/刷新带 `?session=` 时恢复那一局：走既有 resume 路径（后端 404 兜底归属）
	useEffect(() => {
		if (deepLinkDoneRef.current) return;
		const raw = searchParams.get("session");
		if (!raw || !/^\d+$/.test(raw)) return;
		deepLinkDoneRef.current = true;
		void resume({ id: Number(raw) });
	}, [searchParams]);

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
		rememberSession(null);
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
	const talkTo = (_actor: ScenarioActor) => {
		if (!view || view.free_input === false) return;
		// 点在场者 = **把焦点送进输入框**，不替学生组织句子：
		// 合成「对X说：」这类句式（还带括号注解）会让学生看到一段自己没写的文本，
		// 而且一眼就是平台拼的。要说什么，学生自己写。
		setFocusToken((token) => token + 1);
	};

	// 唯一等于"功能未开启"的事实：pack 列表本身 404（命名空间整体不可用）
	if (packsQuery.error && isScenarioUnavailable(packsQuery.error)) {
		return (
			<div className="sc-root" data-view="gate">
				<div className="sc-gate">
					<div className="sc-gate-title">情境训练当前未开启</div>
					<div className="sc-gate-body">请找管理员开启。</div>
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
			<div className="sc-root" data-view="report" data-lost={report.lost}>
				<ConsoleTopbar
					onBack={goBack}
					title={report.pack.title}
					meta={
						<>
							<span>已结算</span>
							<button type="button" className="sc-btn" onClick={leaveSession}>
								回到我的情境
							</button>
						</>
					}
				/>
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
	const fallbackNotice =
		shownView === null ? null : studentFallbackNotice(shownView.problems);

	// ── 动作流程（页面持有）：气泡流里的选项条与底部输入条是同一个流程的两个入口 ──
	const openAffordance =
		shownView === null
			? null
			: (shownView.affordances.find((item) => item.id === openAffordanceId) ??
				null);

	/** `confirm: true` 的动作都要二次确认——选项条、affordance 入口、表单三处同一条口径。 */
	const submitConfirmed = async (
		action: ScenarioActionInput,
		label: string,
		needsConfirm: boolean,
	) => {
		if (needsConfirm) {
			const ok = await confirm({
				title: label,
				message: "这个动作不可逆。",
				confirmLabel: "继续",
				danger: true,
			});
			if (!ok) return;
		}
		submit(action);
	};

	/** DM 的选项：落在表单型动作上就展开表单（不替学生把选项定死），其余直接提交。 */
	const runOption = (option: ScenarioOption) => {
		if (shownView === null) return;
		const linked = option.affordance_id
			? shownView.affordances.find((item) => item.id === option.affordance_id)
			: undefined;
		if (linked && (linked.select !== "none" || linked.type === "document")) {
			setOpenAffordanceId(linked.id);
			return;
		}
		void submitConfirmed(
			{
				affordance_id: option.affordance_id ?? null,
				type: option.type ?? "ask",
				text: option.label ?? null,
			},
			option.label ?? linked?.label ?? "确认",
			linked?.confirm === true,
		);
	};

	/** 唯一的提交入口：选项条、表单、自由通道都走这里；提交即收起表单。 */
	const submitAction = (action: ScenarioActionInput) => {
		setOpenAffordanceId(null);
		submit(action);
	};

	const panels = shownView === null ? null : resolvePanels(shownView.panels);

	return (
		<div
			className="sc-root"
			data-view={shownView === null ? "open" : "session"}
			data-lost={view?.session.lost ?? false}
		>
			{shownView === null ? (
				<>
					<ConsoleTopbar onBack={goBack} title="情境训练" />
					<div className="sc-gate sc-gate-wide">
					<div className="sc-open">
						<div className="sc-gate-title">情境训练</div>
						{opening && (
							<div className="sc-open-status" role="status">
								正在开启情境…
							</div>
						)}
						{packs.length === 0 ? (
							<div className="sc-gate-body">还没有可用的情境包。</div>
						) : (
							<div className="sc-packs">
								{packs.map((pack) => {
									// 没有可用修订的包点了必然失败：不给点（也不给一行占位说明）
									const usable = pack.revision_id !== null;
									return (
										<button
											key={pack.key}
											type="button"
											className="sc-pack"
											disabled={busy || !usable}
											aria-disabled={!usable}
											onClick={() => usable && start(pack)}
										>
											<span className="sc-pack-title">{pack.title}</span>
											{usable && (
												<span className="sc-pack-one-line">{pack.one_line}</span>
											)}
										</button>
									);
								})}
							</div>
						)}

						<section className="sc-history" aria-label="我的情境经历">
							<div className="sc-panel-head">
								<span>我的情境经历</span>
								<span className="sc-panel-toggle-mark">{history.length} 次</span>
							</div>
							{historyQuery.isLoading ? (
								<div className="sc-empty">正在读取…</div>
							) : historyQuery.isError ? (
								<div className="sc-history-error">
									<div className="sc-empty">
										情境经历读取失败：
										{getApiErrorMessage(historyQuery.error, "请稍后重试")}
									</div>
									<button
										type="button"
										className="sc-ghost-btn"
										onClick={() => historyQuery.refetch()}
									>
										重试
									</button>
								</div>
							) : history.length === 0 ? (
								<div className="sc-empty">还没有情境经历。</div>
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
											<span className="sc-history-title">{row.pack_title}</span>
											<span className="sc-history-meta">{sessionRowMeta(row)}</span>
										</button>
									))}
								</div>
							)}
						</section>
					</div>
					</div>
				</>
			) : (
				<>
					{shownView.session.lost && (
						<div className="sc-lost-banner">
							<span>已达到不可逆结局</span>
						</div>
					)}
					{ended && (
						<div className="sc-lost-banner" data-kind="ended">
							<span>这次情境已经结束</span>
							<span className="sc-lost-sub" role="alert">
								{actionError}
							</span>
							<button type="button" className="sc-btn" onClick={close}>
								看经历
							</button>
						</div>
					)}

					<ConsoleTopbar
						onBack={goBack}
						title={shownView.pack.title}
						meta={
							<>
								<span>第 {shownView.session.turn} 回合</span>
								<ScenarioProgress
									dims={
										panels !== null && (panels.emotion || panels.coverage)
											? shownView.dims
											: []
									}
								/>
								<button
									type="button"
									className="sc-btn"
									disabled={busy}
									onClick={close}
								>
									结束并看经历
								</button>
							</>
						}
					/>

					<VisuallyHidden role="status" aria-live="polite">
						{announcement}
					</VisuallyHidden>

					<div className="sc-main">
						<div className="sc-column">
							<ScenarioStage
								view={shownView}
								onTalkTo={talkTo}
								streaming={streaming}
								showSituation={panels?.coverage === true}
								optionSlot={
									shownView.options.length > 0 ? (
										<ScenarioOptionStrip
											options={shownView.options}
											busy={busy}
											onChoose={runOption}
										/>
									) : null
								}
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

							{fallbackNotice !== null && (
								<div className="sc-note" role="status">
									{fallbackNotice}
								</div>
							)}

							{shownView.nudges.length > 0 && (
								<div className="sc-nudges">
									{shownView.nudges.map((nudge) => (
										<div className="sc-nudge" key={nudge}>
											<span>{nudge}</span>
										</div>
									))}
								</div>
							)}

							{!ended && (
								<ActionBar
									view={shownView}
									busy={busy}
									focusToken={focusToken}
									freeText={freeText}
									onFreeTextChange={setFreeText}
									onSubmit={submitAction}
									errorMessage={actionError}
									openAffordance={openAffordance}
									onCloseForm={() => setOpenAffordanceId(null)}
								/>
							)}
						</div>

						<ScenarioSidePanel view={shownView} />
					</div>
				</>
			)}
		</div>
	);
}

