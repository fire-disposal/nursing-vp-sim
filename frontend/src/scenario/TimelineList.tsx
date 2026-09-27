import type {
	ScenarioActor,
	ScenarioTimelineEntry,
} from "@/api/scenario";

/**
 * 经历时间线：按回合分组的学生动作 + 世界的回应。
 *
 * 侧栏与结算页展示同一份 `timeline`（后端 `build_view`/`report` 的同一投影），
 * 所以分组逻辑只有这一处。
 */
export default function TimelineList({
	timeline,
	actors,
	emptyLabel = "还没有动作。",
}: {
	timeline: ScenarioTimelineEntry[];
	actors: ScenarioActor[];
	emptyLabel?: string;
}) {
	const byTurn = new Map<number, ScenarioTimelineEntry[]>();
	for (const entry of timeline) {
		const bucket = byTurn.get(entry.turn);
		if (bucket) bucket.push(entry);
		else byTurn.set(entry.turn, [entry]);
	}
	const turns = [...byTurn.entries()].sort(([a], [b]) => a - b);

	if (turns.length === 0) {
		return <div className="sc-empty">{emptyLabel}</div>;
	}

	return (
		<>
			{turns.map(([turn, entries]) => (
				<div key={turn}>
					<div className="sc-timeline-turn">
						<span>第 {turn} 回合</span>
					</div>
					{entries.map((entry, index) => (
						<div
							className="sc-timeline-item"
							data-kind={entry.kind}
							key={`${turn}-${index}-${entry.label}`}
						>
							<span className="sc-timeline-rail" data-kind={entry.kind} />
							<div>
								<div className="sc-timeline-label">{entry.label}</div>
								{entry.kind === "world" && (
									<div className="sc-timeline-by">
										{(entry.by &&
											(actors.find((actor) => actor.id === entry.by)?.role ??
												entry.by)) ||
											"世界"}
										的回应
									</div>
								)}
							</div>
						</div>
					))}
				</div>
			))}
		</>
	);
}
