import { VisuallyHidden } from "@mantine/core";
import {
	IconAlertTriangle,
	IconDots,
	IconHistory,
	IconPlayerPlay,
	IconStack2,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
	type ComponentType,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import { useSearchParams } from "react-router-dom";
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
	ScenarioHttpError,
	type ScenarioOption,
	type ScenarioPackSummary,
	type ScenarioReport,
	type ScenarioSessionRow,
	ScenarioStreamUnavailable,
	type ScenarioView,
	streamScenarioAction,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorMessage } from "@/utils/error";
import ActionBar, { type ScenarioIntent, ScenarioOptionStrip } from "./ActionBar";
import { ScenarioProgress } from "./DimCard";
import { resolvePanels } from "./panels";
import { studentFallbackNotice } from "./problems";
import ScenarioReportView from "./ScenarioReportView";
import ScenarioSidePanel, { sidePanelNames } from "./ScenarioSidePanel";
import ScenarioStage from "./ScenarioStage";
import {
	draftView,
	hasStudentLine,
	mergeBlocks,
	type PendingStudentLine,
	type ScenarioStreamDraft,
	studentDeclaration,
} from "./stream";
import "./scenario.css";
import {
	groupConsecutiveSessions,
	type ScenarioSessionGroup,
	sessionRowMeta,
} from "./sessions";
import { useNarrowScreen } from "./viewport";

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
 *
 * ── 壳与沉浸（2026-09-28 反馈后的口径）─────────────────────────────────
 * 本页跑在**常规 App 壳里**（`activity: "manage"`）：桌面侧栏、移动端底部 Tab 都在，
 * 「情境」当前项高亮。**沉浸只体现在场景内部**——舞台 / 对话流 / 输入这一块在窄屏
 * 走"一屏、内部滚动、输入常驻"的做法（见 `scenario.css` 的移动端一节），
 * 而不是把全站导航拿掉（那样学生切不回训练/记录，观感也格格不入）。
 */

/** 「我的情境经历」默认只铺开最近几条：30+ 行会把入口页拉成长页，想看全部的人自己展开。 */
const HISTORY_PREVIEW = 8;

/**
 * 控制台自带的**页头**：系统导航壳（`ManageShell`）已经给了"我在哪、怎么出去"，
 * 所以这里**不再自带返回**——App 导航的「情境」（桌面侧栏 / 移动端底部 Tab）就是出口，
 * 会话里再点它就是回到情境入口（见 `backToListOnNav` 那段 effect）。
 *
 * 留下的只有 App 不提供的东西：病例名（App 只显示导航条目名）、回合 / 进度（各视图传入）
 * 与右端**一个**动作控件（`end`）——窄屏是一枚 `⋯` 菜单（抽屉入口 + 结束），桌面是直给的按钮。
 * 三块**任何宽度下都在一行里**：窄屏放不下时收缩的是病例名与进度，不是把动作挤到第二行。
 */
function ConsoleTopbar({
	title,
	meta,
	end,
}: {
	title: string;
	meta?: ReactNode;
	/** 页头右端的动作控件（会话里是「⋯」菜单或「结束」按钮；结算页是回列表）。 */
	end?: ReactNode;
}) {
	return (
		<div className="sc-topbar">
			<span className="sc-topbar-title" title={title}>
				{title}
			</span>
			{meta !== undefined && <span className="sc-topbar-meta">{meta}</span>}
			{end !== undefined && <span className="sc-topbar-end">{end}</span>}
		</div>
	);
}

/**
 * 页头右端的 `⋯` 菜单：**一个**控件装下两个动作，词面各说各的事、不重复。
 *
 * - 「进展」= 线索 / 时间线那块面板（窄屏默认收着，从底部升起）；
 * - 「结束」= 结算本局（**不可逆**），用分隔线拉开距离 + 危险色，不加解释文字。
 *
 * 只在"抽屉真的有东西可看、且当前宽度下它有入口"时用；否则页头给直给的「结束」按钮，
 * 不拿单条目菜单充当按钮。
 *
 * 自建（与「经历量化」的弹层同一套做法），不用 Mantine 的 `Menu`：控制台整体自建组件，
 * 而且 Mantine 弹层走 portal 挂到 body 下 —— `.sc-root` 上的 `--sc-*` 刻度在那里不存在，
 * 反而要为一个菜单再补一套颜色与高度。
 */
function ScenarioTopbarMenu({
	toggleRef,
	disabled,
	onOpenSide,
	onClose,
}: {
	toggleRef: RefObject<HTMLButtonElement | null>;
	disabled: boolean;
	onOpenSide: () => void;
	onClose: () => void;
}) {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLSpanElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		// 打开即落在第一项上：键盘/读屏不必先"猜到"菜单在哪
		menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
		const onPointerDown = (event: PointerEvent) => {
			if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				// 收起并把焦点还回页头入口（键盘/读屏不会掉在虚空里）
				setOpen(false);
				toggleRef.current?.focus();
				return;
			}
			// 菜单是"临时浮层"：Tab 走人，别留一个悬着的面板
			if (event.key === "Tab") {
				setOpen(false);
				return;
			}
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			const items = Array.from(
				menuRef.current?.querySelectorAll<HTMLButtonElement>(
					"[role='menuitem']:not(:disabled)",
				) ?? [],
			);
			if (items.length === 0) return;
			event.preventDefault();
			const current = items.indexOf(document.activeElement as HTMLButtonElement);
			const step = event.key === "ArrowDown" ? 1 : -1;
			const next = (current + step + items.length) % items.length;
			items[next].focus();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, toggleRef]);

	return (
		<span className="sc-topbar-menu" ref={wrapRef}>
			<button
				ref={toggleRef}
				type="button"
				className="sc-btn sc-topbar-more"
				aria-label="更多操作"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls="sc-topbar-menu"
				onClick={() => setOpen((value) => !value)}
			>
				<IconDots size={16} aria-hidden="true" />
			</button>
			{open && (
				<div
					ref={menuRef}
					id="sc-topbar-menu"
					className="sc-menu"
					role="menu"
					aria-label="更多操作"
				>
					<button
						type="button"
						role="menuitem"
						className="sc-menu-item"
						onClick={() => {
							setOpen(false);
							onOpenSide();
						}}
					>
						进展
					</button>
					<div className="sc-menu-sep" aria-hidden="true" />
					<button
						type="button"
						role="menuitem"
						className="sc-menu-item sc-menu-danger"
						disabled={disabled}
						onClick={() => {
							setOpen(false);
							onClose();
						}}
					>
						结束
					</button>
				</div>
			)}
		</span>
	);
}

/**
 * 空态：与 `/training` 的 `EmptyState` 同一写法（虚线图标瓷片 + 一级标题 + 可选动作），
 * 只是这里用控制台自己的形状刻度画（不自带调色板、不引入 Mantine 组件）。
 */
function ConsoleEmpty({
	icon: Icon,
	title,
	description,
	action,
	compact = false,
}: {
	icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
	title: string;
	description?: string;
	action?: ReactNode;
	/** 嵌在已有边框的容器里（如「我的情境经历」）时收紧纵向留白。 */
	compact?: boolean;
}) {
	return (
		<div className="sc-blank" data-compact={compact}>
			<span className="sc-blank-icon">
				<Icon size={26} strokeWidth={1.5} />
			</span>
			<div className="sc-blank-title">{title}</div>
			{description !== undefined && <div className="sc-blank-desc">{description}</div>}
			{action !== undefined && <div className="sc-blank-action">{action}</div>}
		</div>
	);
}

/**
 * 「我的情境经历」的单条：点它回到那次经历。
 *
 * 折叠组里展开出来的几条也是它（`nested` 只改左缩进——层级靠位置表达，不另造样式）。
 */
function HistoryRow({
	row,
	busy,
	onResume,
	nested = false,
}: {
	row: ScenarioSessionRow;
	busy: boolean;
	onResume: (row: ScenarioSessionRow) => void;
	nested?: boolean;
}) {
	return (
		<button
			type="button"
			className="sc-history-item"
			data-status={row.status}
			data-nested={nested ? "true" : undefined}
			disabled={busy}
			onClick={() => onResume(row)}
		>
			<span className="sc-history-title">{row.pack_title}</span>
			<span className="sc-history-meta">{sessionRowMeta(row)}</span>
		</button>
	);
}

/**
 * 「我的情境经历」里**连续同名**病例折成的一行：病例名 ×N + 最新一条的状态与时间。
 *
 * 同一个病例反复练是常态（8 行里 6 行是同一个），逐行铺开只是噪声。点这一行展开/收起
 * 组内的几条——「展开/收起」就在行内同刻度的一角（沿用既有文本式展开交互，不引入新控件形态）。
 * 折叠**只**发生在相邻同名时（见 `groupConsecutiveSessions`），不跨行重排、不改单条文案。
 */
function HistoryFold({
	group,
	busy,
	onResume,
}: {
	group: ScenarioSessionGroup;
	busy: boolean;
	onResume: (row: ScenarioSessionRow) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="sc-history-fold">
			<button
				type="button"
				className="sc-history-item sc-history-fold-head"
				aria-expanded={open}
				disabled={busy}
				onClick={() => setOpen((value) => !value)}
			>
				<span className="sc-history-title">
					{group.title} ×{group.rows.length}
				</span>
				<span className="sc-history-meta">{sessionRowMeta(group.latest)}</span>
				<span className="sc-history-fold-hint" aria-hidden="true">
					{open ? "收起" : "展开"}
				</span>
			</button>
			{open &&
				group.rows.map((row) => (
					<HistoryRow
						key={row.id}
						row={row}
						busy={busy}
						onResume={onResume}
						nested
					/>
				))}
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
	/**
	 * 待定学生条目（乐观）：提交瞬间就进对话流，权威 `view` 一到即被正式消息整体接管。
	 * 只活"view 未到"的窗口（见 `stream.ts`），所以永远不会与正式消息同时出现。
	 */
	const [pendingStudent, setPendingStudent] =
		useState<PendingStudentLine | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [streamFailed, setStreamFailed] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	/**
	 * 最近一次提交的**回滚档案**：失败时按它撤下待定气泡、把输入框还原，
	 * 「重试」也用它原样再来一次（不必从头猜标签与文案）。
	 */
	const lastSubmitRef = useRef<{
		action: ScenarioActionInput;
		label: string;
		/** 这次提交从自由输入框里拿走的那一句；按钮/表单动作没有"框里那一份" → null。 */
		restoreText: string | null;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [freeText, setFreeText] = useState("");
	/**
	 * 本回合的**声明**（对在场者说 / 自定义行动）：没选就不发送。
	 * 由页面持有（输入条与提交都要它），并在开局/重入/离开时归零——新一局的第一句话必须重新声明。
	 */
	const [intent, setIntent] = useState<ScenarioIntent | null>(null);
	/** 展开中的 affordance 表单（选项条与输入条共用同一份流程状态）。 */
	const [openAffordanceId, setOpenAffordanceId] = useState<string | null>(null);
	/** 「我的情境经历」是否已展开全部（默认只显示 `HISTORY_PREVIEW` 条）。 */
	const [historyExpanded, setHistoryExpanded] = useState(false);
	/**
	 * 窄屏的**经历面板抽屉**（线索 / 时间线）是否展开。桌面常驻、与它无关；
	 * 默认收起 = 默认不占纵向空间（2026-09-28：右栏整块排在对话流之后会把页面拉得很长）。
	 */
	const [sideOpen, setSideOpen] = useState(false);
	const sideToggleRef = useRef<HTMLButtonElement>(null);
	/** 窄屏时页头右端换成「⋯」菜单（抽屉只在这个宽度下才是浮层，也才有"召唤"这回事）。 */
	const narrow = useNarrowScreen();
	const { confirm } = useConfirm();

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
			// 新一局不许带上一局的残留：草稿、待定气泡与"流式中断"提示都清掉
			setDraft(null);
			setPendingStudent(null);
			setStreamFailed(null);
			setFreeText("");
			setIntent(null);
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
			setPendingStudent(null);
			setStreamFailed(null);
			setFreeText("");
			setIntent(null);
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
	 *
	 * 待定学生条目在这里退场：对话流以 `view.messages` 为准重绘（后端已把他的动作作为
	 * `role="student"` 条目带了回来），因此**不会**出现"待定的 + 正式的"两条。
	 */
	const applyTurnResult = (nextView: ScenarioView) => {
		setView(nextView);
		setDraft(null);
		setPendingStudent(null);
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

	/**
	 * 回滚一条"还没落地"的提交：撤下待定气泡，并把自由通道的原话还回输入框。
	 *
	 * 「还回哪一句」由回滚档案里的 `restoreText` 决定：按钮/表单动作没有"框里那一份"，
	 * 把它们塞回输入框等于替学生写话，所以只有自由通道才还原。
	 * 且只在框还空着时还——学生已经在打下一句了就别动他的字。
	 */
	const rollbackPending = () => {
		setPendingStudent(null);
		const restore = lastSubmitRef.current?.restoreText ?? null;
		if (restore === null) return;
		setFreeText((current) => (current === "" ? restore : current));
	};

	/**
	 * 提交一个动作。
	 *
	 * - `label` = 该动作的**可读标签**（DM 选项的 label / affordance 的 label）；
	 *   气泡文案取 `action.text or label`——与后端 `runtime/view.py` 的 `action.text or
	 *   action.label(pack)` 逐字同口径，接管时才不会换词。
	 * - `restoreText` 非空 = 这一份来自自由输入框：框里那一句在提交瞬间变成气泡，先把框清空，
	 *   失败时再还回去（见 `rollbackPending`）。
	 *
	 * 提交**瞬间**就把这句话作为待定气泡放进对话流（不等权威 `view`）：
	 * 此前他要盯着"正在生成…"看几秒，流里没有自己那句话，交互上像发进了虚空。
	 */
	const submit = async (
		action: ScenarioActionInput,
		label = "",
		restoreText: string | null = null,
	) => {
		if (sessionId === null || busy) return;
		// 「重试」时框里可能还着那一句（照旧拿走），也可能学生已经另写了新的一句——
		// 后者不动他的字，也不把这一份算作"欠他一次还原"。
		const ownsBox =
			restoreText !== null && (freeText === "" || freeText === restoreText);
		lastSubmitRef.current = {
			action,
			label,
			restoreText: ownsBox ? restoreText : null,
		};
		if (ownsBox) setFreeText("");
		const line = action.text || label;
		// 回合号是**预测**的（后端 `world.turn + 1`）：预测只用于"同回合 + 同文案"去重，
		// 猜错也只是退回"以 view.messages 为准"的整体替换，不会留下幽灵气泡。
		const declaration = studentDeclaration(action);
		setPendingStudent(
			line === ""
				? null
				: { text: line, turn: (view?.session.turn ?? 0) + 1, declaration },
		);
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
						// 权威结果：它覆盖一切（草稿与待定条目都丢掉）
						settled = true;
						applyTurnResult(event.view);
						return;
					}
					// error：保留已渲染的内容，给重试入口；他那一句没落地 → 撤下并还回输入框
					settled = true;
					setStreamFailed(event.message);
					rollbackPending();
				},
				controller.signal,
			);
			if (!settled) {
				setStreamFailed("本回合没有拿到完整结果，可以重试。");
				rollbackPending();
			}
		} catch (err) {
			if (err instanceof ScenarioStreamUnavailable) {
				// 流式这条路走不通 → 自动退回非流式（不得比今天更差）
				try {
					await submitPlain(sessionId, action);
				} catch (fallbackErr) {
					const message = absorbError(fallbackErr, "提交动作失败");
					if (message) setActionError(message);
					rollbackPending();
				}
			} else if (err instanceof ScenarioHttpError) {
				const message = absorbError(
					{ isAxiosError: true, response: { status: err.status, data: { detail: err.detail } } },
					"提交动作失败",
				);
				if (message) setActionError(message);
				rollbackPending();
			} else if (!controller.signal.aborted) {
				const message = absorbError(err, "提交动作失败");
				if (message) setActionError(message);
				rollbackPending();
			}
		} finally {
			abortRef.current = null;
			setStreaming(false);
			setBusy(false);
		}
	};

	/**
	 * 地址栏里的 `?session=` 就是"这一局开着"。两个方向都由它驱动：
	 *
	 * 1) 直达/刷新带参数 → 恢复那一局（走既有 resume 路径，后端 404 兜底归属）；
	 * 2) **参数从有到无 → 回情境入口**。App 导航的「情境」（桌面侧栏 / 移动端底部 Tab）
	 *    指的就是不带参数的 `/scenario`，所以"会话里再点「情境」"= 退出这一局回列表——
	 *    控制台不再自带返回，出口只有这一条，必须真的能用（2026-09-28）。
	 *    会话本身留在后端，从"我的情境经历"随时能继续。
	 *
	 * 判据必须是"**从有到无**"（`previousUrlSession`），不能只看"现在没有"：
	 * `setSearchParams` 走 React Router 的 transition（低优先级），开局那一帧会出现
	 * "sessionId 已就位、地址栏还没写进去"的中间态——只看当下会把刚开的一局立刻关掉。
	 */
	const urlSession = searchParams.get("session");
	const previousUrlSession = useRef<string | null>(null);

	useEffect(() => {
		if (deepLinkDoneRef.current) return;
		deepLinkDoneRef.current = true;
		if (!urlSession || !/^\d+$/.test(urlSession)) return;
		void resume({ id: Number(urlSession) });
	}, [urlSession]);

	// 这两个 effect 必须在**任何提前 return 之前**（结算视图也有自己的 return，hook 数要拉平）
	useEffect(() => {
		if (previousUrlSession.current !== null && urlSession === null) leaveSession();
		previousUrlSession.current = urlSession;
	}, [urlSession]);

	// 抽屉展开时 Esc 收起（与遮罩、页头入口同一件事）
	useEffect(() => {
		if (!sideOpen) return;
		const onKey = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setSideOpen(false);
			sideToggleRef.current?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [sideOpen]);

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

	/**
	 * 离开当前会话、回到情境入口（列表）。写成**函数声明**（会被提升）：`backToListOnNav`
	 * 那段 effect 在它上面，但两者都在任何提前 return 之前。
	 */
	function leaveSession() {
		rememberSession(null);
		setSessionId(null);
		setView(null);
		setReport(null);
		setEnded(false);
		setActionError(null);
		setDraft(null);
		setPendingStudent(null);
		setStreamFailed(null);
		setIntent(null);
		// 抽屉不跨局：回到入口列表时它是关着的（换一局也不带着上一局的展开态）
		setSideOpen(false);
		historyQuery.refetch();
	}

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
	// 「我的情境经历」：先按"默认只铺 8 条"截取（截的是**行**），再把连续同名病例折成一行。
	// 顺序不能倒：先折叠再截取会让"8 条"变成"8 组"，展开之后条数对不上。
	const historyGroups = groupConsecutiveSessions(
		historyExpanded ? history : history.slice(0, HISTORY_PREVIEW),
	);

	if (report && view) {
		return (
			<div className="sc-root" data-view="report" data-lost={report.lost}>
				<ConsoleTopbar
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

	// 渲染用视图：权威视图叠加"已经写完的块"（草稿）与"还没落地的学生条目"（待定）。
	// 权威 view 一到，草稿与待定条目一起被丢掉（`applyTurnResult`）——展示永远不是真相。
	// 防重复：若权威视图里已经有同回合同文案的正式消息（后端把他的动作带回来了），
	// 待定的那条立刻不渲染，不必等下一次状态更新。
	const shownPending =
		pendingStudent !== null &&
		view !== null &&
		!hasStudentLine(view, pendingStudent)
			? pendingStudent
			: null;
	const shownView = view === null ? null : draftView(view, draft, shownPending);
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
		// `label` 与后端 `action.label(pack)` 同口径：气泡文案与权威消息才会是同一句
		submit(action, label);
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
		// 只有自由输入条会给出"没有表单归属"的动作（表单动作的 `affordance_id` 恒非空）：
		// 框里那一句作为 `restoreText` 交出去——它在提交瞬间变成气泡，失败时再还回框里。
		// 表单/按钮动作不动输入框（那是学生自己的草稿），所以不给 `restoreText`。
		if (action.affordance_id == null) {
			submit(action, "", action.text ?? null);
			return;
		}
		submit(action, openAffordance?.label ?? "");
	};

	const panels = shownView === null ? null : resolvePanels(shownView.panels);
	/** 经历面板此刻有哪些页签（空数组 = 没东西可看，页头就不给抽屉入口）。 */
	const sideNames = shownView === null ? [] : sidePanelNames(shownView);
	/** 收起抽屉并把焦点还给页头的入口按钮（键盘/读屏不会掉在虚空里）。 */
	const closeSide = () => {
		setSideOpen(false);
		sideToggleRef.current?.focus();
	};

	return (
		<div
			className="sc-root"
			data-view={shownView === null ? "open" : "session"}
			data-lost={view?.session.lost ?? false}
		>
			{shownView === null ? (
				<>
					{/* 入口页**不带自己的页头**：App 导航（侧栏 / 底部 Tab）已经高亮「情境」，
					    这里再写一遍「情境训练」就是同一句话说两遍；内容区自带 H2 立语义。 */}
					<div className="sc-gate sc-gate-wide">
					<section className="sc-open" aria-label="情境训练">
						{/* 内容标题：与 /training 的 H2 同刻度（22/700），只表达"选一个情境"，
						    不重复 App 导航的条目名，也不写说明文字（UI 审计 C5）。 */}
						<div className="sc-open-head">
							<h2 className="sc-open-title">选一个情境开始</h2>
							{opening && (
								<div className="sc-open-status" role="status">
									正在开启情境…
								</div>
							)}
						</div>
						{packs.length === 0 ? (
							<ConsoleEmpty icon={IconStack2} title="还没有可用的情境包。" />
						) : (
							<div className="sc-packs">
								{packs.map((pack) => {
									// 没有可用修订的包点了必然失败：不给点（也不给一行占位说明）
									const usable = pack.revision_id !== null;
									// 卡片徽章只承接病例自己的两个学生语义字段（我是谁 / 我在哪）；
									// 缺哪项就不显示哪枚——不显示 state/revision_no 这类作者态字段（UI 审计 C4）。
									const badges = [pack.player_role, pack.place].filter(Boolean);
									return (
										<article key={pack.key} className="sc-pack" data-usable={usable}>
											<div className="sc-pack-head">
												<h3 className="sc-pack-title">{pack.title}</h3>
												{usable && (
													<p className="sc-pack-one-line">{pack.one_line}</p>
												)}
											</div>
											{badges.length > 0 && (
												<div className="sc-pack-badges">
													{badges.map((label) => (
														<span key={label} className="sc-badge">
															{label}
														</span>
													))}
												</div>
											)}
											<div className="sc-pack-actions">
												<button
													type="button"
													className="sc-btn sc-btn-lg sc-pack-start"
													disabled={busy || !usable}
													aria-disabled={!usable}
													aria-label={`开始「${pack.title}」`}
													onClick={() => usable && start(pack)}
												>
													<IconPlayerPlay size={14} aria-hidden="true" />
													开始
												</button>
											</div>
										</article>
									);
								})}
							</div>
						)}

						<section className="sc-history" aria-label="我的情境经历">
							<div className="sc-section-head">
								<IconHistory size={16} className="sc-section-icon" aria-hidden="true" />
								<span className="sc-section-title">我的情境经历</span>
								{history.length > 0 && (
									<span className="sc-section-mark">{history.length} 次</span>
								)}
							</div>
							{historyQuery.isLoading ? (
								<div className="sc-blank" data-compact="true">
									<div className="sc-blank-title">正在读取…</div>
								</div>
							) : historyQuery.isError ? (
								<ConsoleEmpty
									icon={IconAlertTriangle}
									title="情境经历读取失败"
									description={getApiErrorMessage(historyQuery.error, "请稍后重试")}
									compact
									action={
										<button
											type="button"
											className="sc-btn sc-btn-lg"
											onClick={() => historyQuery.refetch()}
										>
											重试
										</button>
									}
								/>
							) : history.length === 0 ? (
								<ConsoleEmpty icon={IconHistory} title="还没有情境经历。" compact />
							) : (
								<>
									<div className="sc-history-list">
										{historyGroups.map((group) =>
											group.rows.length === 1 ? (
												<HistoryRow
													key={group.id}
													row={group.latest}
													busy={busy}
													onResume={resume}
												/>
											) : (
												<HistoryFold
													key={group.id}
													group={group}
													busy={busy}
													onResume={resume}
												/>
											),
										)}
									</div>
									{history.length > HISTORY_PREVIEW && (
										<button
											type="button"
											className="sc-ghost-btn sc-history-more"
											onClick={() => setHistoryExpanded((open) => !open)}
										>
											{historyExpanded ? "收起" : `还有 ${history.length - HISTORY_PREVIEW} 次`}
										</button>
									)}
								</>
							)}
						</section>
					</section>
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
							</>
						}
						end={
							/* 窄屏且抽屉真有东西可看：一个「⋯」装下两个动作。
							   其余情况（桌面右栏常驻、包没声明任何面板）没有可召唤的抽屉，
							   就直给「结束」——不为一个条目摆菜单。 */
							narrow && sideNames.length > 0 ? (
								<ScenarioTopbarMenu
									toggleRef={sideToggleRef}
									disabled={busy}
									onOpenSide={() => setSideOpen(true)}
									onClose={close}
								/>
							) : (
								<button type="button" className="sc-btn" disabled={busy} onClick={close}>
									结束
								</button>
							)
						}
					/>

					<VisuallyHidden role="status" aria-live="polite">
						{announcement}
					</VisuallyHidden>

					<div className="sc-main">
						<div className="sc-column">
							<ScenarioStage
								view={shownView}
								streaming={streaming}
								showResources={panels?.coverage === true}
								actorStrip="unaddressable"
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
											const last = lastSubmitRef.current;
											if (last) {
												void submit(last.action, last.label, last.restoreText);
											}
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
									intent={intent}
									onIntentChange={setIntent}
								/>
							)}
						</div>

						<ScenarioSidePanel
							view={shownView}
							open={sideOpen}
							onClose={closeSide}
						/>
					</div>
					{/* 窄屏抽屉的遮罩：点一下收起（桌面不显示，见 scenario.css）。
					    DOM 只在真的展开时存在，读屏/键盘不会碰到一个隐形的层。 */}
					{sideOpen && sideNames.length > 0 && (
						<button
							type="button"
							className="sc-sheet-backdrop"
							aria-label="收起经历面板"
							tabIndex={-1}
							onClick={closeSide}
						/>
					)}
				</>
			)}
		</div>
	);
}

