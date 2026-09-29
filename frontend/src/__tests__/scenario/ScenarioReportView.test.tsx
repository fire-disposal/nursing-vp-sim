import { describe, expect, it } from "vitest";
import { render, screen, within } from "@/__tests__/render";
import type { ScenarioReport } from "@/api/scenario";
import ScenarioReportView from "@/scenario/ScenarioReportView";
import { makeReport, makeView } from "./fixtures";

/**
 * 复盘页（`report` 是新形状）：**先看事情，再看评价**（`docs/scenario.md` §7.7）。
 *
 * 断言只针对**层级与取舍**：结局读得出真实终态、关键时刻带学生原话+证据+变化、
 * 反思有才渲染、分数与判读退到次级折叠区（且在关键时刻之后）。不钉具体句子措辞。
 */

/** 终态视图：已结束（报告页天然是回看态）。 */
function finishedView() {
	return makeView({
		session: {
			id: 12,
			status: "completed",
			turn: 3,
			lost: false,
			seq: 9,
			trial: false,
		},
	});
}

function renderReport(report: ScenarioReport | null, view = finishedView()) {
	return render(<ScenarioReportView report={report} view={view} actions={null} />);
}

const MAIN_BLOCK_ORDER = [
	".sc-report-head",
	'[aria-label="关键时刻"]',
	'[aria-label="值得再想的一处决策"]',
	'[aria-label="全部经历"]',
	'[aria-label="判读详情"]',
] as const;

describe("复盘页：先看事情，再看评价", () => {
	it.each([
		["lost", /不可逆/],
		["ended_by_student", /主动结束/],
	] as const)("结局按真实终态读出：%s", (status, pattern) => {
		renderReport(
			makeReport({
				outcome: { status, reason: "", turn: 5, lost: status === "lost" },
			}),
		);

		const head = document.querySelector(".sc-report-sub") as HTMLElement;
		expect(head.textContent).toMatch(pattern);
		// 时间单位数是回看信息，不是"训练完成度"
		expect(head.textContent).toMatch(/共 5 个时间单位/);
		// 主动提前结束不得被补写成"已完成训练"
		expect(head.textContent).not.toMatch(/已完成/);
	});

	it("关键时刻给出：学生原话 + 当时的证据 + 已记录的变化", () => {
		renderReport(makeReport());

		const keyTurns = screen.getByLabelText("关键时刻");
		expect(within(keyTurns).getByText("时间单位 1")).toBeInTheDocument();
		expect(
			within(keyTurns).getByText("我先看看他的呼吸。"),
		).toBeInTheDocument();
		expect(within(keyTurns).getByText("当时的证据")).toBeInTheDocument();
		expect(within(keyTurns).getByText("指脉氧 89%")).toBeInTheDocument();
		expect(within(keyTurns).getByText("已记录的变化")).toBeInTheDocument();
		expect(within(keyTurns).getByText("患者呼吸仍然费力")).toBeInTheDocument();
		// 学生面不再出现"回合"这种引擎口径
		expect(
			(document.querySelector(".sc-report") as HTMLElement).textContent,
		).not.toMatch(/回合/);
	});

	it("没有关键时刻时不编造因果，只说这一局没有特别标出的时刻", () => {
		renderReport(makeReport({ key_turns: [] }));

		const keyTurns = screen.getByLabelText("关键时刻");
		expect(within(keyTurns).queryByText(/当时的证据/)).toBeNull();
		expect(within(keyTurns).getByText(/没有特别标出的时刻/)).toBeInTheDocument();
	});

	it("反思问题只在真的存在时渲染", () => {
		const { unmount } = renderReport(makeReport());
		expect(screen.getByLabelText("值得再想的一处决策")).toBeInTheDocument();
		expect(
			screen.getByText("当时还有哪条线索没有核查？"),
		).toBeInTheDocument();
		unmount();

		renderReport(makeReport({ reflection: null }));
		expect(screen.queryByLabelText("值得再想的一处决策")).toBeNull();
	});

	it("分数与逐条判读在次级折叠区里，且排在关键时刻之后", () => {
		renderReport(
			makeReport({
				assessment: {
					summary: { strong: 1, adequate: 0, missed: 1 },
					score: { rate: 0.5, weighted_sum: 50, total_weight: 100 },
					criteria: [
						{
							id: "dp_priority",
							title: "先看安静的那床",
							anchor: "strong",
							score: 1,
							weight: 3,
							detail: "B 床先被处置，且在 2 个时间单位内",
							evidence: ["时间单位 2 到 B 床"],
						},
					],
					dims: [
						{
							id: "d_actions",
							label: "处置动作数",
							agg: "count",
							value: 2,
							unit: "次",
							detail: "共 2 个动作",
						},
					],
				},
			}),
		);

		const assessment = screen.getByLabelText("判读详情") as HTMLDetailsElement;
		expect(assessment.tagName).toBe("DETAILS");
		// 次级：默认折叠，不占首屏
		expect(assessment.open).toBe(false);
		// 得分率与判读都在折叠区**内部**
		const score = within(assessment).getByLabelText("得分率");
		expect(assessment.contains(score)).toBe(true);
		expect(within(assessment).getByText("50%")).toBeInTheDocument();
		expect(
			within(assessment).getByText("先看安静的那床"),
		).toBeInTheDocument();
		expect(
			within(assessment).getByText("B 床先被处置，且在 2 个时间单位内"),
		).toBeInTheDocument();
		expect(within(assessment).getByText("时间单位 2 到 B 床")).toBeInTheDocument();
		// 量化读数也在次级区里，且不出现内部诊断串
		expect(within(assessment).getByText("处置动作数")).toBeInTheDocument();
		// 学生侧不出现权重/加权得分类的取证信息
		expect(assessment.textContent).not.toMatch(/权重|加权得分/);
		expect(assessment.querySelector("[data-weights]")).toBeNull();

		// 层级：结局 → 关键时刻 → 反思 → 全部经历 → 判读详情（顺序即主次）
		const blocks = MAIN_BLOCK_ORDER.map(
			(selector) => document.querySelector(selector) as HTMLElement,
		);
		expect(blocks.every((node) => node !== null)).toBe(true);
		for (let index = 0; index < blocks.length - 1; index += 1) {
			expect(
				blocks[index].compareDocumentPosition(blocks[index + 1]) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
		}
	});

	it("没有可计权条目时给「—」，不假装 0 分", () => {
		renderReport(
			makeReport({
				assessment: {
					summary: { strong: 0, adequate: 0, missed: 0 },
					score: { rate: null, weighted_sum: 0, total_weight: 0 },
					criteria: [],
					dims: [],
				},
			}),
		);

		const assessment = screen.getByLabelText("判读详情");
		expect(within(assessment).getByText("—")).toBeInTheDocument();
		expect(within(assessment).queryByText("0%")).toBeNull();
	});
});

describe("两种报告都没有", () => {
	it("显示未结算态，不假装有复盘", () => {
		renderReport(null, finishedView());

		expect(screen.getByText(/本局没有结算/)).toBeInTheDocument();
		expect(screen.getByText(/没有留下结算/)).toBeInTheDocument();
		expect(screen.queryByLabelText("关键时刻")).toBeNull();
	});
});
