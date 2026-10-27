import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@/__tests__/render";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrainingSelect from "@/pages/TrainingSelect";
import useAuthStore from "@/stores/authStore";

const mocks = vi.hoisted(() => ({
	getRecords: vi.fn(),
	abandonRecord: vi.fn(),
	getCases: vi.fn(),
	getNotifications: vi.fn(),
	markNotificationRead: vi.fn(),
	startBlindBox: vi.fn(),
	startTraining: vi.fn(),
	getStudentAssignments: vi.fn(),
	startAssignment: vi.fn(),
	getTrends: vi.fn(),
}));

vi.mock("@/api", () => ({
	getRecords: mocks.getRecords,
	abandonRecord: mocks.abandonRecord,
	getCases: mocks.getCases,
	getNotifications: mocks.getNotifications,
	markNotificationRead: mocks.markNotificationRead,
	startBlindBox: mocks.startBlindBox,
	startTraining: mocks.startTraining,
}));

vi.mock("@/api/assignments", () => ({
	getStudentAssignments: mocks.getStudentAssignments,
	startAssignment: mocks.startAssignment,
}));

vi.mock("@/api/stats", () => ({
	getTrends: mocks.getTrends,
}));

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/training"]}>
				<TrainingSelect />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	useAuthStore.setState({
		user: { id: 7, display_name: "学生", username: "s", role: "student" } as never,
		permissions: [],
	});
	mocks.getRecords.mockResolvedValue({ data: { items: [], total: 0 } });
	mocks.getCases.mockResolvedValue({ data: { items: [], total: 0 } });
	mocks.getNotifications.mockResolvedValue({ data: { items: [], total: 0 } });
	mocks.getStudentAssignments.mockResolvedValue({ data: [] });
	mocks.getTrends.mockResolvedValue({
		data: {
			daily: [{ date: "2026-09-01", sessions: 2, minutes: 40, avg_score: 88 }],
			total_sessions: 2,
			total_minutes: 40,
			avg_score: 84.5,
		},
	});
});

afterEach(() => {
	useAuthStore.setState({ user: null, permissions: [] });
	vi.clearAllMocks();
});

describe("学生自视图统计", () => {
	it("只展示本人数据，不请求同伴榜单（无排名/百分位）", async () => {
		renderPage();

		expect(await screen.findByText("我的平均展示分")).toBeInTheDocument();
		expect(screen.getByText(/84.5分/)).toBeInTheDocument();
		expect(screen.getByText("我的完成训练")).toBeInTheDocument();
		expect(screen.queryByText("排名")).not.toBeInTheDocument();
	});

	it("趋势条用服务端日粒度字段（date/avg_score），标签为本人数值参考", async () => {
		renderPage();

		expect(await screen.findByText("我的得分趋势（数值参考）")).toBeInTheDocument();
		// 只有 /stats/trends 到达后才会出现日粒度趋势条
		expect(await screen.findByText("09-01")).toBeInTheDocument();
		expect(screen.getByText("88")).toBeInTheDocument();
	});
});
