import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ScoreboardPage from "@/pages/admin/ScoreboardPage";
import { getScoreboardRanking } from "@/api/scoreboard";

vi.mock("@/api/scoreboard", () => ({
	getScoreboardRanking: vi.fn(() =>
		Promise.resolve({ data: { items: [], total: 0, summary: {} } }),
	),
	getStudentTrend: vi.fn(() => Promise.resolve({ data: null })),
}));

vi.mock("@/api/assignments", () => ({
	getAssignments: vi.fn(() => Promise.resolve({ data: { items: [] } })),
}));

vi.mock("@/api/cases", () => ({
	getManageCases: vi.fn(() => Promise.resolve({ data: { items: [] } })),
}));

vi.mock("@/api/grades-classes", () => ({
	getClasses: vi.fn(() => Promise.resolve({ data: [] })),
}));

const renderPage = (url: string) => {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[url]}>
				<ScoreboardPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
};

describe("ScoreboardPage ranking filter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("passes the selected assignment_id to the ranking request", async () => {
		renderPage("/scoreboard?assignment_id=ASSIGN-1");
		await waitFor(() => expect(getScoreboardRanking).toHaveBeenCalled());
		expect(getScoreboardRanking).toHaveBeenCalledWith(
			expect.objectContaining({ assignment_id: "ASSIGN-1" }),
		);
	});

	it("passes null assignment_id when no assignment is selected", async () => {
		renderPage("/scoreboard");
		await waitFor(() => expect(getScoreboardRanking).toHaveBeenCalled());
		expect(getScoreboardRanking).toHaveBeenCalledWith(
			expect.objectContaining({ assignment_id: null }),
		);
	});

	it("renders the scoreboard page", async () => {
		renderPage("/scoreboard");
		expect(screen.getByText("成绩管理")).toBeInTheDocument();
	});
});
