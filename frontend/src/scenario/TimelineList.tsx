import { useState } from "react";
import type { ScenarioTimelineEntry } from "@/api/scenario";
import TurnLocator from "./TurnLocator";

/**
 * 经历时间线：按**时间单位**分组的学生动作 + 世界的回应（同一时间单位内的多条属于同一时间点）。
 *
 * 侧栏与经历页展示同一份 `timeline`（后端 `build_view`/`report` 的同一投影），
 * 所以分组逻辑只有这一处。
 *
 * 排版：每个时间单位两行——**你做了什么（正文色）+ 世界怎么变（弱化色）**；时间标记是极小的
 * 弱化前缀；用行距与 1px 分隔线组织，不用圆点/色条列表。
 *
 * - 侧栏（`collapseLatest`）：**最新时间单位在上**，只看最新，其余折在"全部 N 个时间单位"后面——
 *   学生最需要的是"我刚做了什么、世界怎么变"。
 * - 经历页：全量、按发生顺序（叙述顺序），用于回看全过程。
 * - 归属不署名（"X 的回应"是系统在解释投影规则）；长文截断，需要时单条展开。
 */

function TimelineEntry({ entry }: { entry: ScenarioTimelineEntry }) {
	const [expanded, setExpanded] = useState(false);
	// 单行约 20–22 字；两行以上才值得给"展开"
	const long = entry.label.length > 44;
	return (
		<div className="sc-timeline-item" data-kind={entry.kind}>
			<div className="sc-timeline-label" data-expanded={expanded}>
				{entry.label}
			</div>
			{long && (
				<button
					type="button"
					className="sc-timeline-more"
					aria-expanded={expanded}
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? "收起" : "展开"}
				</button>
			)}
		</div>
	);
}

export default function TimelineList({
	timeline,
	emptyLabel = "还没有动作。",
	collapseLatest = false,
	onLocateTurn,
}: {
	timeline: ScenarioTimelineEntry[];
	emptyLabel?: string;
	/** 只显示最新一个时间单位（其余折在"全部 N 个时间单位"后）；侧栏用。 */
	collapseLatest?: boolean;
	/** 点时间标记 → 页面把它滚进视野（不传则不渲染可点时间点）。 */
	onLocateTurn?: (turn: number) => void;
}) {
	const [showAll, setShowAll] = useState(false);
	const byTurn = new Map<number, ScenarioTimelineEntry[]>();
	for (const entry of timeline) {
		const bucket = byTurn.get(entry.turn);
		if (bucket) bucket.push(entry);
		else byTurn.set(entry.turn, [entry]);
	}
	const turns = [...byTurn.entries()].sort(([a], [b]) =>
		collapseLatest ? b - a : a - b,
	);

	if (turns.length === 0) {
		return <div className="sc-empty">{emptyLabel}</div>;
	}

	const collapsed = collapseLatest && !showAll && turns.length > 1;
	const shown = collapsed ? turns.slice(0, 1) : turns;

	return (
		<div className="sc-timeline">
			{collapseLatest && turns.length > 1 && (
				<button
					type="button"
					className="sc-timeline-more"
					aria-expanded={showAll}
					onClick={() => setShowAll((value) => !value)}
				>
					{showAll ? "只看最新" : `全部 ${turns.length} 个时间单位`}
				</button>
			)}
			{shown.map(([turn, entries]) => (
				<div key={turn}>
					<div className="sc-timeline-turn">
						<TurnLocator turn={turn} onLocateTurn={onLocateTurn} />
					</div>
					{entries.map((entry, index) => (
						<TimelineEntry entry={entry} key={`${turn}-${index}-${entry.label}`} />
					))}
				</div>
			))}
		</div>
	);
}
