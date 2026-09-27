import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@/__tests__/render";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScoreboardPage from "@/pages/admin/ScoreboardPage";

const mocks = vi.hoisted(() => ({
	getScoreboardRanking: vi.fn(),
	getStudentTrend: vi.fn(),
	getAssignments: vi.fn(),
	getManageCases: vi.fn(),
	getClasses: vi.fn(),
}));

vi.mock("@/api/scoreboard", () => ({
	getScoreboardRanking: mocks.getScoreboardRanking,
	getStudentTrend: mocks.getStudentTrend,
}));

vi.mock("@/api/assignments", () => ({
	getAssignments: mocks.getAssignments,
}));

vi.mock("@/api/cases", () => ({
	getManageCases: mocks.getManageCases,
}));

vi.mock("@/api/classes", () => ({
	getClasses: mocks.getClasses,
}));

/** 服务端等第政策块：数值分段标签与阈值只由它给出（前端不得自己算） */
const POLICY = {
	id: "nursing_history_grade",
	version: 1,
	calibrated: false,
	capability_available: false,
	capability_label: "尚未校准能力等第",
	capability_note: "能力等第需要教师校准裁判例后才能启用",
	numeric_bands: [
		{ band: "good", min: 90, label: "数值参考 · 高" },
		{ band: "medium", min: 70, label: "数值参考 · 中" },
	],
	numeric_band_description: "按展示分固定阈值分段，只描述数值位置",
};

function renderPage(search: string) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[`/admin/scoreboard${search}`]}>
				<ScoreboardPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mocks.getScoreboardRanking.mockResolvedValue({
		data: { items: [], total: 0, summary: { record_count: 0, student_count: 0 } },
	});
	mocks.getAssignments.mockResolvedValue({ data: { items: [] } });
	mocks.getManageCases.mockResolvedValue({ data: { items: [] } });
	mocks.getClasses.mockResolvedValue({ data: [] });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("ScoreboardPage 作业筛选", () => {
	it("ranking 请求携带 URL 中的 assignment_id", async () => {
		renderPage("?assignment_id=asg-123");

		await waitFor(() => expect(mocks.getScoreboardRanking).toHaveBeenCalled());

		const params = mocks.getScoreboardRanking.mock.calls[0][0];
		expect(params.assignment_id).toBe("asg-123");
	});

	it("未选择作业时 ranking 请求 assignment_id 为 null", async () => {
		renderPage("?case_id=1");

		await waitFor(() => expect(mocks.getScoreboardRanking).toHaveBeenCalled());

		const params = mocks.getScoreboardRanking.mock.calls[0][0];
		expect(params.assignment_id).toBeNull();
	});

	it("服务端未给 policy 时不标注数值分段（不在客户端自造分段名）", async () => {
		mocks.getScoreboardRanking.mockResolvedValue({
			data: {
				items: [{ rank: 1, user_id: 1, display_name: "甲同学", class_name: "一班", avg_score: 92, tier: "good", training_count: 1, case_count: 1 }],
				total: 1,
				summary: { record_count: 1, student_count: 1, avg_score: 92, tier_counts: { good: 1 } },
			},
		});
		renderPage("");

		await waitFor(() => expect(mocks.getScoreboardRanking).toHaveBeenCalled());
		await waitFor(() => expect(screen.queryByText("数值分段分布")).not.toBeInTheDocument());
		expect(screen.queryByText("数值参考 · 高")).not.toBeInTheDocument();
	});

	it("渲染成绩管理标题", async () => {
		renderPage("");
		expect(await screen.findByText("成绩管理")).toBeInTheDocument();
	});

	it("数值分段标签与阈值取自服务端 policy（不出现硬编码 85/60 的好中差措辞）", async () => {
		mocks.getScoreboardRanking.mockResolvedValue({
			data: {
				items: [
					{
						rank: 1,
						user_id: 1,
						display_name: "甲同学",
						class_name: "一班",
						avg_score: 92,
						tier: "good",
						training_count: 2,
						case_count: 1,
					},
				],
				total: 1,
				summary: {
					record_count: 2,
					student_count: 1,
					avg_score: 92,
					tier_counts: { good: 1, medium: 0, poor: 0 },
					policy: POLICY,
				},
				policy: POLICY,
			},
		});
		renderPage("");

		// 「数值分段分布」只在拿到 summary.tier_counts 后渲染 —— 用它等数据到达
		expect(await screen.findByText("数值分段分布")).toBeInTheDocument();
		expect(screen.getByText(/平均分 ≥ 90 为「数值参考 · 高」/)).toBeInTheDocument();
		expect(screen.getByText(/数值参考 · 高 1/)).toBeInTheDocument();
		expect(screen.getByText(/尚未校准能力等第/)).toBeInTheDocument();
		// 旧的硬编码阈值与「好中差」措辞必须消失
		expect(screen.queryByText(/≥ 85/)).not.toBeInTheDocument();
		expect(screen.queryByText(/好中差/)).not.toBeInTheDocument();
	});
});
