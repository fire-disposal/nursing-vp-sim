import { describe, expect, it } from "vitest";
import type { ScenarioReport, ScenarioView } from "@/api/scenario";
import { render, screen, within } from "@/__tests__/render";
import ScenarioReportView from "@/scenario/ScenarioReportView";

/** 场景作者自己写的 rubric：条目数、措辞、权重都不同（这里就按"两条 + 一条无证据"来）。 */
function report(): ScenarioReport {
	return {
		pack: { key: "two-beds-priority", title: "两床同铃" },
		turn: 6,
		lost: false,
		summary: { strong: 1, adequate: 0, missed: 1 },
		score: {
			rate: 0.45,
			weighted_sum: 1.8,
			total_weight: 4,
			criteria: [
				{
					id: "dp_priority",
					title: "先看安静的那床",
					anchor: "strong",
					score: 1,
					weight: 3,
					detail: "B 床先被处置，且在 2 回合内",
					evidence: ["第2回合 到 B 床看看"],
				},
				{
					id: "dp_document",
					title: "把判断写下来说清楚",
					anchor: "missed",
					score: 0,
					weight: 1,
					detail: "没有留下护理记录",
					evidence: [],
				},
			],
		},
		criteria: [
			{
				id: "dp_priority",
				title: "先看安静的那床",
				anchor: "strong",
				score: 1,
				weight: 3,
				detail: "B 床先被处置，且在 2 回合内",
				evidence: ["第2回合 到 B 床看看"],
			},
			{
				id: "dp_document",
				title: "把判断写下来说清楚",
				anchor: "missed",
				score: 0,
				weight: 1,
				detail: "没有留下护理记录",
				evidence: [],
			},
		],
		dims: [],
		timeline: [],
		problems: [],
	};
}

function view(): ScenarioView {
	return {
		session: { id: 1, status: "completed", turn: 6, lost: false },
		pack: { key: "two-beds-priority", title: "两床同铃", player_role: "夜班护士" },
		situation: {
			place: "呼吸内科病房",
			time_hint: "",
			resources: [],
			visible_cues: [],
			noticed: [],
		},
		actors: [],
		hud: [],
		messages: [],
		options: [],
		affordances: [],
		free_input: true,
		timeline: [],
		dims: [],
		nudges: [],
		problems: [],
		panels: ["timeline"],
	};
}

describe("经历页：得分率与逐条判读", () => {
	it("学生侧给得分率与逐条判读，但**不含 weight**（权重不进学生视野）", () => {
		const { container } = render(
			<ScenarioReportView report={report()} view={view()} actions={null} />,
		);

		// 得分率：45%
		expect(screen.getByLabelText("得分率")).toBeInTheDocument();
		expect(screen.getByText("45%")).toBeInTheDocument();

		// 逐条：作者写的标题 + 锚点 + 说明 + 证据原话
		const items = container.querySelectorAll("[data-criterion]");
		expect(items).toHaveLength(2);
		const first = container.querySelector('[data-criterion="dp_priority"]') as HTMLElement;
		expect(within(first).getByText("先看安静的那床")).toBeInTheDocument();
		expect(within(first).getByText("强")).toBeInTheDocument();
		expect(within(first).getByText("B 床先被处置，且在 2 回合内")).toBeInTheDocument();
		expect(within(first).getByText("第2回合 到 B 床看看")).toBeInTheDocument();
		expect(first.dataset.anchor).toBe("strong");
		const second = container.querySelector('[data-criterion="dp_document"]') as HTMLElement;
		expect(second.dataset.anchor).toBe("missed");
		// 没有证据的条目照样成立（不补空壳）
		expect(second.querySelector(".sc-evidence")).toBeNull();

		// 学生侧：权重与逐条得分数值一个都不出现（只看经历页自己的文本，
		// 不把 Mantine 注入的 <style> 也算进去）
		const text = (container.querySelector(".sc-report") as HTMLElement).textContent ?? "";
		expect(text).not.toContain("权重");
		expect(text).not.toContain("weight");
		expect(text).not.toContain("加权得分");
		expect(container.querySelector("[data-weights]")).toBeNull();
	});

	it("管理侧展开完整明细：权重、逐条得分、加权得分 / 权重合计", () => {
		const { container } = render(
			<ScenarioReportView report={report()} view={view()} actions={null} showWeights />,
		);

		const summary = screen.getByText(/加权得分 1\.8 \/ 权重合计 4/);
		expect(summary).toBeInTheDocument();
		// 维护者看得见的作者口径提示（每包权重合计 100 便于心算，但不合计也合法）
		expect(summary.textContent).toContain("每包权重合计 100");
		const weightRows = container.querySelectorAll('[data-weights="criterion"]');
		expect(weightRows).toHaveLength(2);
		expect(weightRows[0]?.textContent).toContain("权重 3");
		expect(weightRows[0]?.textContent).toContain("得分 1");
		expect(weightRows[0]?.textContent).toContain("dp_priority");
	});

	it("没有可计权条目时给「—」并说明原因，不假装 0 分", () => {
		const empty = report();
		empty.score = { rate: null, weighted_sum: 0, total_weight: 0, criteria: [] };
		empty.criteria = [];
		render(<ScenarioReportView report={empty} view={view()} actions={null} />);

		expect(screen.getByText("—")).toBeInTheDocument();
		expect(
			screen.getByText("本情境没有可计权的条目——判读仍然逐条保留在下面。"),
		).toBeInTheDocument();
		expect(screen.getByText("这次情境没有留下可判读的条目。")).toBeInTheDocument();
	});
});
