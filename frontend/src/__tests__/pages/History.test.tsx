import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@/__tests__/render";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import History from "@/pages/History";

const mocks = vi.hoisted(() => ({
	getRecords: vi.fn(),
	deleteRecord: vi.fn(),
	abandonRecord: vi.fn(),
}));

vi.mock("@/api", () => ({
	getRecords: mocks.getRecords,
	deleteRecord: mocks.deleteRecord,
	abandonRecord: mocks.abandonRecord,
}));

function record(over: Record<string, unknown>) {
	return {
		id: 1,
		case_id: 1,
		case_name: "甲病例",
		user_id: 7,
		user_display_name: "学生",
		user_student_id: null,
		score_reviewed: false,
		status: "completed",
		scoring_status: "completed",
		scoring_error: null,
		start_time: "2026-09-01T10:00:00",
		end_time: "2026-09-01T10:20:00",
		score_total: 88,
		is_student_practice: true,
		assignment_id: null,
		assignment_title: null,
		...over,
	};
}

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/history"]}>
				<History />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mocks.getRecords.mockResolvedValue({
		data: {
			items: [
				record({ id: 1, case_name: "甲病例", score_reviewed: true, score_total: 88 }),
				record({ id: 2, case_name: "乙病例", score_reviewed: false, score_total: 70 }),
				record({ id: 3, case_name: "丙病例", score_total: null, scoring_status: "processing" }),
			],
			total: 3,
		},
	});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("训练记录的状态词表", () => {
	it("discarded/abandoned 不再渲染成「进行中」，只有进行中的记录可续练", async () => {
		mocks.getRecords.mockResolvedValue({
			data: {
				items: [
					record({ id: 1, case_name: "弃置病例", status: "discarded", score_total: null, scoring_status: null }),
					record({ id: 2, case_name: "中止病例", status: "abandoned", score_total: null, scoring_status: null }),
					record({ id: 3, case_name: "续练病例", status: "in_progress", score_total: null, scoring_status: null, end_time: null }),
				],
				total: 3,
			},
		});
		renderPage();

		// 唯一的续练入口属于 in_progress：discarded/abandoned 都走只读详情
		await waitFor(() => expect(screen.getAllByText("继续训练")).toHaveLength(1));
		expect(screen.getAllByText("点卡片继续问诊")).toHaveLength(1);
		expect(screen.getAllByText("已作废").length).toBeGreaterThan(0);
		expect(screen.getAllByText("已放弃").length).toBeGreaterThan(0);
	});

	it("未知状态原样显示并按只读处理", async () => {
		mocks.getRecords.mockResolvedValue({
			data: { items: [record({ id: 9, case_name: "新状态病例", status: "paused", score_total: null })], total: 1 },
		});
		renderPage();

		await waitFor(() => expect(screen.getAllByText("paused").length).toBeGreaterThan(0));
		expect(screen.queryByText("继续训练")).not.toBeInTheDocument();
		expect(screen.getAllByText("查看").length).toBeGreaterThan(0);
	});
});

describe("训练记录的成绩来源", () => {
	it("按复核状态显示来源：教师复核 / AI 初评，未评分不给来源标签", async () => {
		renderPage();

		// 移动卡片与桌面表格都会渲染（响应式靠 CSS 切换），因此同名徽标出现两次
		expect(await screen.findAllByText("教师复核")).toHaveLength(2);
		expect(screen.getAllByText("AI 初评")).toHaveLength(2);
		// 未评分记录（score_total=null）只显示来源占位符，不冒充 AI 初评
		expect(screen.getAllByText(/评分中/).length).toBeGreaterThan(0);
	});

	it("数值只是数值参考：不渲染能力等第/优秀·合格标签，并显式说明来源口径", async () => {
		renderPage();

		await screen.findAllByText("教师复核");
		expect(screen.queryByText(/优秀|合格|尚未校准能力等第/)).not.toBeInTheDocument();
		expect(screen.getAllByText(/不代表能力等第/).length).toBeGreaterThan(0);
	});
});
