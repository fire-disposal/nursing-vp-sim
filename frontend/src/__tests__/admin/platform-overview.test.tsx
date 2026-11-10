import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import PlatformOverviewPage from "@/pages/ops/PlatformOverviewPage";

vi.mock("@/api/admin/schools", () => ({
	getSchools: vi.fn().mockResolvedValue({
		data: [
			{
				id: 1,
				name: "甲大学",
				class_count: 3,
				user_count: 42,
				admin_count: 2,
				theme_color: null,
				has_logo: false,
				logo_updated_at: null,
				created_at: "2026-01-01T00:00:00Z",
			},
		],
	}),
}));

vi.mock("@/api/admin/ops", () => ({
	fetchDiagnose: vi.fn().mockResolvedValue({
		data: {
			llm: {
				total_calls_24h: 128,
				success_rate: 98.5,
				error_count_24h: 2,
				avg_latency_ms: 420,
				recent_errors: [],
			},
			scoring: {
				pending: 1,
				in_progress: 2,
				completed_24h: 6,
				failed_24h: 0,
				success_rate: 100,
			},
			voice: {
				tts: {
					calls_24h: 9,
					success_rate: 100,
					error_count_24h: 0,
					avg_latency_ms: 300,
					cost_24h: 0.1,
				},
			},
			voice_budget: { monthly_budget: 0, monthly_cost: 0, usage_pct: 0 },
			business: { today_users: 7, today_trainings: 12, today_completed: 9 },
			feedback: { scope: "db", window: "rolling", unanswered: 3, oldest_created_at: null, oldest_age_days: null },
			metrics: { active_sessions: 2, version: "test" },
			errors: {
				scope: "workers",
				window_by_count: {},
				count: { last_5min: 0, last_hour: 0, total_captured: 0, unique_24h: 0 },
				recent: [],
			},
			alerts: [],
		},
	}),
}));

vi.mock("@/api/admin/voice-cost", () => ({
	fetchCostDashboard: vi.fn().mockResolvedValue({
		data: {
			this_month: { calls: 1, success: 1, error: 0, latency_ms_avg: 1, total_cost: 12.5 },
			monthly_budget: 100,
		},
	}),
}));

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={["/admin/platform"]}>
				<Routes>
					<Route path="/admin/platform" element={<PlatformOverviewPage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("平台总览", () => {
	it("展示跨院校规模、运行状态与成本", async () => {
		renderPage();

		expect(await screen.findByRole("heading", { name: "平台总览" })).toBeInTheDocument();
		expect(await screen.findByText("甲大学")).toBeInTheDocument();
		expect(screen.getByText("¥12.50")).toBeInTheDocument();
		expect(screen.getByText("运行正常")).toBeInTheDocument();
		expect(screen.getByText("3 条")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "成本管理" })).toBeInTheDocument();

		await waitFor(() => {
			expect(screen.getByText("本月 LLM + TTS 成本")).toBeInTheDocument();
		});
	});
});
