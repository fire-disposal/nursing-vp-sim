import type { ScenarioReport, ScenarioView } from "@/api/scenario";
import DimCard from "./DimCard";
import { resolvePanels } from "./panels";
import TimelineList from "./TimelineList";

const TIER_LABEL: Record<string, string> = {
	strong: "强",
	adequate: "合格",
	missed: "漏",
};

const TIER_ORDER = ["strong", "adequate", "missed"] as const;

/** 判读档位的名字（未知值原样显示，不假装认识）。 */
export function tierLabel(anchor: string): string {
	return TIER_LABEL[anchor] ?? anchor;
}

/** 结局的读法：**真实终态**。主动提前结束就写提前结束，不补成"已完成训练"。 */
const OUTCOME_LABEL: Record<string, string> = {
	lost: "已达到不可逆结局",
	ended_by_student: "你主动结束了本次情境",
	cutover: "机制切换，本局已封存",
};

/**
 * 复盘页：**先看事情，再看评价**（`docs/23` §7.7）。
 *
 * 顺序是：结局与处境 → 关键时刻（原话与证据）→ 值得再想的一处决策 → 全部经历 →
 * 判读详情（次级、折叠）。分数不再占据首屏，也不冒充能力诊断；没有证据就不声称因果。
 *
 * 旧机制会话的报告**不能套新形状**：`legacy_report` 是原样留档的旧报告，
 * 这里只读地展开它，不重算、不改写、不补生成（`docs/23` §9.1）。
 */
export default function ScenarioReportView({
	report,
	legacyReport = null,
	view,
	actions,
	showWeights = false,
}: {
	/** 新形状报告；旧机制会话为 `null`（见 `legacyReport`）。 */
	report: ScenarioReport | null;
	/** 切换前会话的原报告：**原样留档**，只读展示。 */
	legacyReport?: Record<string, unknown> | null;
	view: ScenarioView;
	actions: React.ReactNode;
	/** 管理侧回放：显示权重与数值明细（学生侧恒为 false）。 */
	showWeights?: boolean;
}) {
	const panels = resolvePanels(view.panels);
	// 与侧栏一致：dims 是"情绪/覆盖"共用的经历量化投影，任一被声明就展示。
	const showDims = panels.emotion || panels.coverage;

	if (report === null) {
		return (
			<div className="sc-report">
				<div className="sc-report-head">
					<div className="sc-report-title">{view.pack.title}</div>
					<div className="sc-report-sub">
						{legacyReport !== null ? "机制切换前的本局记录" : "本局未结算"}
					</div>
				</div>
				{legacyReport === null ? (
					<div className="sc-empty">
						这一局没有留下结算。已有对话与资料仍可回看。
					</div>
				) : (
					<section className="sc-legacy" aria-label="旧机制原报告（原样留档）">
						<div className="sc-panel-head">
							<span>机制切换前的原报告</span>
							<span>原样留档 · 未重算</span>
						</div>
						<pre className="sc-legacy-json">
							{JSON.stringify(legacyReport, null, 2)}
						</pre>
					</section>
				)}
				<div className="sc-report-actions">{actions}</div>
			</div>
		);
	}

	const assessment = report.assessment;
	const criteria = assessment.criteria ?? [];
	const summary = assessment.summary ?? {};
	const dims = assessment.dims ?? [];
	const keyTurns = report.key_turns ?? [];
	const timeline = report.timeline ?? [];
	const outcome = OUTCOME_LABEL[report.outcome.status] ?? report.outcome.status;

	return (
		<div className="sc-report">
			<div className="sc-report-head">
				<div className="sc-report-title">{report.pack.title}</div>
				<div className="sc-report-sub">
					{outcome}
					{report.outcome.reason !== "" && ` ｜ ${report.outcome.reason}`}
					{` ｜ 共 ${report.outcome.turn} 个时间单位`}
				</div>
			</div>

			{/* 1. 关键时刻：你做了什么、当时有什么证据、发生了哪些已记录的变化 */}
			<section className="sc-panel" aria-label="关键时刻">
				<div className="sc-panel-head">
					<span>关键时刻</span>
					<span>共 {keyTurns.length} 处</span>
				</div>
				{keyTurns.length === 0 ? (
					<div className="sc-empty">这一局没有特别标出的时刻。</div>
				) : (
					<div className="sc-key-turns">
						{keyTurns.map((item) => (
							<div className="sc-key-turn" key={item.turn}>
								<div className="sc-key-turn-head">
									<span className="sc-key-turn-no">时间单位 {item.turn}</span>
									<span className="sc-key-turn-said">{item.student}</span>
								</div>
								{(item.evidence ?? []).length > 0 && (
									<div className="sc-key-turn-row">
										<span className="sc-key-turn-label">当时的证据</span>
										<span className="sc-evidence">
											{(item.evidence ?? []).map((line, index) => (
												<span
													className="sc-evidence-chip"
													key={`${item.turn}-ev-${index}-${line}`}
												>
													{line}
												</span>
											))}
										</span>
									</div>
								)}
								{(item.changes ?? []).length > 0 && (
									<div className="sc-key-turn-row">
										<span className="sc-key-turn-label">已记录的变化</span>
										<span className="sc-evidence">
											{(item.changes ?? []).map((line, index) => (
												<span
													className="sc-evidence-chip"
													key={`${item.turn}-ch-${index}-${line}`}
												>
													{line}
												</span>
											))}
										</span>
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</section>

			{/* 2. 值得再想的一处决策：只基于已有事件，没有因果证据时后端就不给问题 */}
			{report.reflection !== null && report.reflection !== undefined && (
				<section className="sc-reflection" aria-label="值得再想的一处决策">
					<div className="sc-reflection-label">值得再想的一处决策</div>
					<p className="sc-reflection-text">{report.reflection}</p>
				</section>
			)}

			{/* 3. 全部经历：回看用，默认折叠 */}
			{panels.timeline && timeline.length > 0 && (
				<details className="sc-panel sc-report-fold" aria-label="全部经历">
					<summary className="sc-panel-head">
						<span>全部经历</span>
						<span>共 {timeline.length} 条</span>
					</summary>
					<div className="sc-panel-body">
						<TimelineList timeline={timeline} />
					</div>
				</details>
			)}

			{/* 4. 判读详情：次级、可展开，明确是场景规则反馈，不冒充能力诊断 */}
			<details className="sc-panel sc-report-fold sc-assessment" aria-label="判读详情">
				<summary className="sc-panel-head">
					<span>判读详情</span>
					<span>场景规则反馈 · 可展开</span>
				</summary>
				<div className="sc-panel-body">
					<section className="sc-score" aria-label="得分率">
						<div className="sc-score-value">
							{assessment.score.rate == null
								? "—"
								: `${Math.round(assessment.score.rate * 100)}%`}
						</div>
						<div className="sc-score-body">
							<div className="sc-score-label">得分率</div>
							{showWeights && (
								<div className="sc-report-sub" data-weights="summary">
									加权得分 {assessment.score.weighted_sum} / 权重合计{" "}
									{assessment.score.total_weight}
									{" ｜ "}
									作者口径：每包权重合计 100，便于心算（不合计也合法——得分率一律按权重合计归一化）。
								</div>
							)}
						</div>
					</section>

					{/* 判读档位计数：强/合格/漏 是场景作者写的判据档位，不是任务状态机 */}
					<div className="sc-anchor-counts">
						<span className="sc-report-sub">判读档位</span>
						{TIER_ORDER.map((anchor) => (
							<div className="sc-anchor-count" key={anchor}>
								<b>{summary[anchor] ?? 0}</b>
								<span className="sc-report-sub">{tierLabel(anchor)}</span>
							</div>
						))}
					</div>

					<div className="sc-criteria">
						{criteria.length === 0 ? (
							<div className="sc-empty">没有判读。</div>
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
											{tierLabel(criterion.anchor)}
										</span>
									</div>
									{criterion.detail && (
										<div className="sc-criterion-detail">{criterion.detail}</div>
									)}
									{(criterion.evidence ?? []).length > 0 && (
										<div className="sc-evidence">
											{(criterion.evidence ?? []).map((item, index) => (
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

					{showDims && dims.length > 0 && (
						<div className="sc-dims">
							{dims.map((dim) => (
								<div key={dim.id}>
									<DimCard dim={dim} />
									{/* 判读口径（含内部字段名）只在管理侧取证时显示：学生面不出现诊断串 */}
									{showWeights && dim.detail !== "" && (
										<div className="sc-dim-detail">{dim.detail}</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			</details>

			<div className="sc-report-actions">{actions}</div>
		</div>
	);
}

/** 判读档位 → CSS 变量后缀（三档的颜色在样式表里定义，页面不各写一遍色值）。 */
function anchorStyle(anchor: string): string {
	if (anchor === "strong") return "ok";
	if (anchor === "adequate") return "warn";
	return "bad";
}
