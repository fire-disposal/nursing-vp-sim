import type { ScenarioReport, ScenarioView } from "@/api/scenario";
import DimCard from "./DimCard";
import { resolvePanels } from "./panels";
import TimelineList from "./TimelineList";

const ANCHOR_LABEL: Record<string, string> = {
	strong: "强",
	adequate: "合格",
	missed: "漏",
};

const ANCHOR_ORDER = ["strong", "adequate", "missed"] as const;

/** 锚点名（未知值原样显示，不假装认识）。 */
export function anchorLabel(anchor: string): string {
	return ANCHOR_LABEL[anchor] ?? anchor;
}

/**
 * 经历页（结算）：**得分率** + 逐条 rubric + 锚点分布 + dims + 时间线。
 *
 * 两条口径上的克制：
 * - 学生侧**不显示 `weight` 与逐条得分数值**——权重是平台/维护者的事，学生看到只会去凑分；
 *   他们需要的是"这条在评什么、我落在哪一档、凭什么"（`title` / 锚点 / `detail` / 证据原话）。
 * - rubric 是**场景作者自己写的**（条目数、措辞、权重都不同），所以这里完全不假设条目数，
 *   也不改写作者的标题与说明。
 *
 * 管理侧（`showWeights`）才展开完整明细：权重、逐条得分、加权得分 / 权重合计，
 * 便于维护者核对"这条为什么这么算"。
 */
export default function ScenarioReportView({
	report,
	view,
	actions,
	showWeights = false,
}: {
	report: ScenarioReport;
	view: ScenarioView;
	actions: React.ReactNode;
	/** 管理侧回放：显示权重与数值明细（学生侧恒为 false）。 */
	showWeights?: boolean;
}) {
	const panels = resolvePanels(view.panels);
	// 与侧栏一致：dims 是"情绪/覆盖"共用的经历量化投影，任一被声明就展示。
	const showDims = panels.emotion || panels.coverage;
	const criteria = report.criteria ?? [];

	return (
		<div className="sc-report">
			<div className="sc-report-head">
				<div className="sc-report-title">{report.pack.title}</div>
				<div className="sc-report-sub">
					{report.lost
						? "已达到不可逆结局——下面是这次情境里真实发生过的判读"
						: "情境已结束——下面是这次情境里真实发生过的判读"}
					{"｜共 "}
					{report.turn} 回合
				</div>
			</div>

			<section className="sc-score" aria-label="得分率">
				<div className="sc-score-value">
					{report.score.rate === null
						? "—"
						: `${Math.round(report.score.rate * 100)}%`}
				</div>
				<div className="sc-score-body">
					<div className="sc-score-label">得分率</div>
					<div className="sc-report-sub">
						{report.score.rate === null
							? "本情境没有可计权的条目——判读仍然逐条保留在下面。"
							: "每条判读先落到锚点（强 / 合格 / 漏），再把它们合成这一个数。"}
					</div>
					{showWeights && (
						<div className="sc-report-sub" data-weights="summary">
							加权得分 {report.score.weighted_sum} / 权重合计{" "}
							{report.score.total_weight}
							{" ｜ "}
							作者口径：每包权重合计 100，便于心算（不合计也合法——得分率一律按权重合计归一化）。
						</div>
					)}
				</div>
			</section>

			<div className="sc-anchor-counts">
				{ANCHOR_ORDER.map((anchor) => (
					<div className="sc-anchor-count" key={anchor}>
						<b>{report.summary[anchor] ?? 0}</b>
						<span className="sc-report-sub">{anchorLabel(anchor)}</span>
					</div>
				))}
			</div>

			<div className="sc-criteria">
				{criteria.length === 0 ? (
					<div className="sc-empty">这次情境没有留下可判读的条目。</div>
				) : (
					criteria.map((criterion) => (
						<div
							className="sc-criterion"
							data-anchor={criterion.anchor}
							data-criterion={criterion.id}
							key={criterion.id}
						>
							<div className="sc-criterion-head">
								<span className="sc-criterion-title">{criterion.title}</span>
								<span
									className="sc-anchor-pill"
									style={{
										color: `var(--sc-${anchorStyle(criterion.anchor)})`,
									}}
								>
									{anchorLabel(criterion.anchor)}
								</span>
							</div>
							{criterion.detail && (
								<div className="sc-criterion-detail">{criterion.detail}</div>
							)}
							{criterion.evidence.length > 0 && (
								<div className="sc-evidence">
									{criterion.evidence.map((item, index) => (
										<span
											className="sc-evidence-chip"
											key={`${criterion.id}-${index}-${item}`}
										>
											{item}
										</span>
									))}
								</div>
							)}
							{showWeights && (
								<div className="sc-criterion-weight" data-weights="criterion">
									权重 {criterion.weight} · 得分 {criterion.score} · 条目 id{" "}
									{criterion.id}
								</div>
							)}
						</div>
					))
				)}
			</div>

			{showDims && report.dims.length > 0 && (
				<div className="sc-dims">
					{report.dims.map((dim) => (
						<DimCard dim={dim} key={dim.id} />
					))}
				</div>
			)}

			{panels.timeline && (
				<section className="sc-panel" aria-label="经历时间线">
					<div className="sc-panel-head">
						<span>经历时间线</span>
						<span>共 {report.timeline.length} 条</span>
					</div>
					<div className="sc-panel-body">
						<TimelineList
							timeline={report.timeline}
							actors={view.actors}
							emptyLabel="这次情境没有留下动作记录。"
						/>
					</div>
				</section>
			)}

			<div className="sc-report-actions">{actions}</div>
		</div>
	);
}

/** 锚点 → CSS 变量后缀（三档锚点的颜色在样式表里定义，页面不各写一遍色值）。 */
function anchorStyle(anchor: string): string {
	if (anchor === "strong") return "strong";
	if (anchor === "adequate") return "warn";
	return "bad";
}
