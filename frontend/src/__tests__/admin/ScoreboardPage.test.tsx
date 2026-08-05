import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/api/grades-classes", () => ({
	getClasses: mocks.getClasses,
}));

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

	it("渲染成绩管理标题", async () => {
		renderPage("");
		expect(await screen.findByText("成绩管理")).toBeInTheDocument();
	});
});
