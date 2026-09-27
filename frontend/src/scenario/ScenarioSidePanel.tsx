import { type KeyboardEvent, useRef, useState } from "react";
import type { ScenarioView } from "@/api/scenario";
import BoardPanel from "./BoardPanel";
import { resolvePanels } from "./panels";
import TimelineList from "./TimelineList";

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
 */
export default function ScenarioSidePanel({ view }: { view: ScenarioView }) {
	const [tab, setTab] = useState<"board" | "timeline">("board");
	const boardTabRef = useRef<HTMLButtonElement>(null);
	const timelineTabRef = useRef<HTMLButtonElement>(null);

	const board = view.board;
	const boardCount =
		board?.sections.reduce(
			(total, section) => total + section.entries.length,
			0,
		) ?? 0;
	const hasBoard = board !== undefined && boardCount > 0;
	const hasTimeline = resolvePanels(view.panels).timeline && view.timeline.length > 0;

	if (!hasBoard && !hasTimeline) return null;

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
			<aside className="sc-side" aria-label="经历面板">
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
		<aside className="sc-side" aria-label="经历面板">
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
