import type { ScenarioView } from "@/api/scenario";
import BoardPanel from "./BoardPanel";
import DimCard from "./DimCard";
import { resolvePanels } from "./panels";
import TimelineList from "./TimelineList";

/**
 * 侧栏：**线索板**（只读事实区，常驻）+ **经历时间线** + **现场** + **经历量化**。
 *
 * 信息只有一处来源：线索与"你注意到的"**只出现在白板上**（后端 `view.board`），
 * 侧栏不再另列一份——同一件事说两遍，学生就要在两处之间找不同。
 * 时间线/量化/现场是否出现由 pack 声明的 `view.panels` 决定（映射见 `panels.ts`）。
 */
export default function ScenarioSidePanel({ view }: { view: ScenarioView }) {
	const panels = resolvePanels(view.panels);
	// 经历量化（dims）是"情绪/覆盖"两类面板共用的数值投影（docs/20：经历量化 = 时间线/情绪/覆盖/趋势），
	// 因此任一量化面板被声明就展示；两者都没声明才收起。
	const showDims = panels.emotion || panels.coverage;
	const anyPanel = panels.timeline || panels.coverage || showDims;
	const board = view.board;

	if (!anyPanel && !board) {
		return (
			<aside className="sc-side">
				<section className="sc-panel" aria-label="经历面板">
					<div className="sc-panel-body">
						<div className="sc-empty">
							这个情境没有声明要展示的面板——经历仍然照常记录，结算时会完整给出。
						</div>
					</div>
				</section>
			</aside>
		);
	}

	return (
		<aside className="sc-side">
			{board && (
				<section className="sc-panel sc-panel-board" aria-label="线索板">
					<div className="sc-panel-head">
						<span>线索板</span>
						<span>{board.entry_count} 条</span>
					</div>
					<div className="sc-panel-body">
						<BoardPanel board={board} />
					</div>
				</section>
			)}

			{panels.timeline && (
				<section className="sc-panel" aria-label="经历时间线">
					<div className="sc-panel-head">
						<span>经历时间线</span>
						<span>第 {view.session.turn} 回合</span>
					</div>
					<div className="sc-panel-body">
						<TimelineList timeline={view.timeline} actors={view.actors} />
					</div>
				</section>
			)}

			{panels.coverage && (
				<section className="sc-panel" aria-label="现场">
					<div className="sc-panel-head">
						<span>现场</span>
						<span>{view.situation.place}</span>
					</div>
					<div className="sc-panel-body">
						<div className="sc-clue">
							时间线索：{view.situation.time_hint || "（未说明）"}
						</div>
						<div className="sc-clue">
							可用资源：
							{view.situation.resources.length > 0
								? view.situation.resources.join("、")
								: "（未说明）"}
						</div>
					</div>
				</section>
			)}

			{showDims && (
				<section className="sc-panel" aria-label="经历量化">
					<div className="sc-panel-head">
						<span>经历量化</span>
						<span>{view.dims.length} 项</span>
					</div>
					<div className="sc-panel-body">
						{view.dims.length === 0 ? (
							<div className="sc-empty">还没有可量化的经历。</div>
						) : (
							view.dims.map((dim) => <DimCard dim={dim} key={dim.id} />)
						)}
					</div>
				</section>
			)}
		</aside>
	);
}
