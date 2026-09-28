import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { ScenarioView } from "@/api/scenario";
import BoardPanel from "./BoardPanel";
import { resolvePanels } from "./panels";
import TimelineList from "./TimelineList";

/** 线索条数：抽屉入口要显示"有东西可看"，也用来判"面板是否成立"。 */
function boardEntryCount(view: ScenarioView): number {
	return (
		view.board?.sections.reduce(
			(total, section) => total + section.entries.length,
			0,
		) ?? 0
	);
}

/**
 * 侧栏此刻**有哪些页签**（`["线索"]` / `["时间线"]` / 两个都有；都没有 = 空数组）。
 *
 * 判据只有这一处：页面据此决定要不要给「召唤」入口、入口怎么写名字——空面板不给按钮，
 * 也不留一个点开是空的抽屉。
 */
export function sidePanelNames(view: ScenarioView): string[] {
	const names: string[] = [];
	if (view.board !== undefined && boardEntryCount(view) > 0) names.push("线索");
	if (resolvePanels(view.panels).timeline && view.timeline.length > 0) {
		names.push("时间线");
	}
	return names;
}

/**
 * 侧栏：**一块卡片 + 两个页签（线索 / 时间线）**，两者共用同一个滚动空间。
 *
 * - 线索 = 只读事实区（后端 `view.board`）：线索与"你注意到的"**只出现在这里**，
 *   同一件事不在别处再说一遍。
 * - 时间线 = 按回合分组的经历（后端 `view.timeline`）：最新回合在上，其余折起来。
 * - 默认停在**线索**（本回合最常用；时间线切过去看全过程）。
 * - 时间线由 pack 声明的 `panels` 决定是否出现（映射见 `panels.ts`）；
 *   **两块都没内容就整块不渲染**——不写空态说明句，也不留空壳。
 *
 * 页签是自建的（不用 Mantine Tabs）：学生控制台整体自建组件，尺寸/形状只由
 * `scenario.css` 的 `--sc-*` 刻度决定。
 *
 * ── 窄屏按需召唤（2026-09-28）─────────────────────────────────────────
 * 桌面是常驻右栏（sticky）；窄屏（≤760）整块排在主列之后会把页面拉得很长、还跟对话流
 * 争注意力，所以改成**默认不占纵向空间的底部抽屉**：传了 `onClose` 才算"可召唤"
 * （`data-sheet`），由页面上的入口按钮开合。**只有内容真的存在时**页面才给入口。
 * 管理侧回放不传 `onClose`：它在窄屏保持原来的整块排布，行为不变。
 */
export default function ScenarioSidePanel({
	view,
	open = true,
	onClose,
}: {
	view: ScenarioView;
	/** 抽屉是否展开（只对"可召唤"形态有意义；桌面常驻，与它无关）。 */
	open?: boolean;
	/** 传了才可召唤（给关闭控件 + 窄屏抽屉形态）；不传 = 常驻排布。 */
	onClose?: () => void;
}) {
	const [tab, setTab] = useState<"board" | "timeline">("board");
	const boardTabRef = useRef<HTMLButtonElement>(null);
	const timelineTabRef = useRef<HTMLButtonElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);

	// 展开时把焦点交给「收起」：触屏与键盘都能立刻退出去（关闭后焦点由页面还给入口按钮）
	useEffect(() => {
		if (open) closeRef.current?.focus();
	}, [open]);

	const board = view.board;
	const boardCount = boardEntryCount(view);
	const hasBoard = board !== undefined && boardCount > 0;
	const hasTimeline = resolvePanels(view.panels).timeline && view.timeline.length > 0;

	if (!hasBoard && !hasTimeline) return null;

	/** 抽屉形态的收起控件：只在窄屏出现（桌面常驻，没有可关的东西）。 */
	const closeButton =
		onClose === undefined ? null : (
			<button
				ref={closeRef}
				type="button"
				className="sc-btn sc-sheet-close"
				onClick={onClose}
			>
				收起
			</button>
		);

	const boardBody = hasBoard && board !== undefined && <BoardPanel board={board} />;
	const timelineBody = (
		<TimelineList timeline={view.timeline} collapseLatest />
	);

	// 两块都有：一个卡片 + 两个页签（左右方向键在两个页签之间移动）
	if (hasBoard && hasTimeline) {
		const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			const next = tab === "board" ? "timeline" : "board";
			setTab(next);
			(next === "board" ? boardTabRef : timelineTabRef).current?.focus();
		};
		return (
			<aside
				id="sc-side-panel"
				className="sc-side"
				aria-label="经历面板"
				data-sheet={onClose !== undefined ? "true" : undefined}
				data-open={open ? "true" : "false"}
			>
				{closeButton}
				<div className="sc-panel sc-tabs">
					<div className="sc-tabs-list" role="tablist" onKeyDown={onKeyDown}>
						<button
							ref={boardTabRef}
							type="button"
							role="tab"
							id="sc-tab-board"
							className="sc-tab"
							aria-selected={tab === "board"}
							aria-controls="sc-tabpanel-board"
							tabIndex={tab === "board" ? 0 : -1}
							onClick={() => setTab("board")}
						>
							线索
						</button>
						<button
							ref={timelineTabRef}
							type="button"
							role="tab"
							id="sc-tab-timeline"
							className="sc-tab"
							aria-selected={tab === "timeline"}
							aria-controls="sc-tabpanel-timeline"
							tabIndex={tab === "timeline" ? 0 : -1}
							onClick={() => setTab("timeline")}
						>
							时间线
						</button>
					</div>
					<div
						className="sc-panel-body"
						role="tabpanel"
						id="sc-tabpanel-board"
						aria-labelledby="sc-tab-board"
						hidden={tab !== "board"}
					>
						{boardBody}
					</div>
					<div
						className="sc-panel-body"
						role="tabpanel"
						id="sc-tabpanel-timeline"
						aria-labelledby="sc-tab-timeline"
						hidden={tab !== "timeline"}
					>
						{timelineBody}
					</div>
				</div>
			</aside>
		);
	}

	// 只有一块：不摆页签（没有可切换的东西就不给切换控件）
	return (
		<aside
			id="sc-side-panel"
			className="sc-side"
			aria-label="经历面板"
			data-sheet={onClose !== undefined ? "true" : undefined}
			data-open={open ? "true" : "false"}
		>
			{closeButton}
			<div className="sc-panel">
				<div className="sc-panel-head">
					<span className="sc-panel-title">
						{hasBoard ? "线索" : "时间线"}
					</span>
				</div>
				<div className="sc-panel-body">
					{hasBoard ? boardBody : timelineBody}
				</div>
			</div>
		</aside>
	);
}
