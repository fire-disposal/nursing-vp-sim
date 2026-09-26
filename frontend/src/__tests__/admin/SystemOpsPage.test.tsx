import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/__tests__/render";
import SystemOpsPage from "@/pages/admin/SystemOpsPage";

const mocks = vi.hoisted(() => ({ fetchDiagnose: vi.fn() }));

vi.mock("@/api/admin/ops", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/api/admin/ops")>();
	return { ...actual, fetchDiagnose: mocks.fetchDiagnose };
});

const BASE = {
	schema_version: 3,
	version: "test-version",
	generated_at: "2026-09-26T00:00:00Z",
	summary: { status: "healthy", alerts: [] },
	alerts: [],
	runtime: { scope: "process", window: "now", cache_ttl_seconds: 120, cached_age_seconds: 1 },
	sessions: { scope: "db", window: "now", active: 0 },
	errors: { scope: "workers", window_by_count: {}, count: {}, recent: [] },
	llm: { total_calls_24h: 0, success_rate: 100, error_count_24h: 0, avg_latency_ms: 0, recent_errors: [] },
	scoring: { pending: 0, in_progress: 0, completed_24h: 0, failed_24h: 0, success_rate: 100 },
	voice_budget: { monthly_budget: 100, monthly_cost: 1, usage_pct: 1 },
	business: { today_users: 0, today_trainings: 0, today_completed: 0 },
	metrics: { uptime_seconds: 3600, version: "test-version" },
} as const;

function renderPage() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<SystemOpsPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("SystemOpsPage 作业队列卡片", () => {
	beforeEach(() => {
		mocks.fetchDiagnose.mockReset();
	});

	it("渲染各 kind 的状态计数与最老等待/过期租约", async () => {
		mocks.fetchDiagnose.mockResolvedValue({
			data: {
				...BASE,
				jobs: {
					scope: "db",
					window: "now",
					by_kind: { scoring: { pending: 2, running: 1, failed: 3 } },
					oldest_pending_seconds: 420,
					expired_leases: 2,
				},
			},
		});

		renderPage();

		await waitFor(() => expect(screen.getByText("作业队列 (jobs)")).toBeInTheDocument());
		expect(screen.getByText("scoring")).toBeInTheDocument();
		expect(screen.getByText("pending 2")).toBeInTheDocument();
		expect(screen.getByText("running 1")).toBeInTheDocument();
		expect(screen.getByText("failed 3")).toBeInTheDocument();
		expect(screen.getByText("420 s")).toBeInTheDocument();
		expect(screen.getByText("2")).toBeInTheDocument();
	});

	it("无作业记录时显示空态而非崩溃", async () => {
		mocks.fetchDiagnose.mockResolvedValue({
			data: {
				...BASE,
				jobs: { scope: "db", window: "now", by_kind: {}, oldest_pending_seconds: 0, expired_leases: 0 },
			},
		});

		renderPage();

		await waitFor(() => expect(screen.getByText("暂无作业记录")).toBeInTheDocument());
	});

	it("旧后端缺少 jobs 块时降级提示", async () => {
		mocks.fetchDiagnose.mockResolvedValue({ data: { ...BASE } });

		renderPage();

		await waitFor(() => expect(screen.getByText("该版本未提供作业块")).toBeInTheDocument());
	});
});
