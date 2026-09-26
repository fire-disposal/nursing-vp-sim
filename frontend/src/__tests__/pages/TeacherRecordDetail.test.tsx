import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@/__tests__/render";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeacherRecordDetail from "@/pages/admin/TeacherRecordDetail";
import useAuthStore from "@/stores/authStore";

const apiMock = vi.hoisted(() => ({
	getRecordDetail: vi.fn(),
	getEmotionEvents: vi.fn(),
	retryScoring: vi.fn(),
	exportRecordDetail: vi.fn(),
}));

vi.mock("@/api/training", () => ({
	getRecordDetail: apiMock.getRecordDetail,
	getEmotionEvents: apiMock.getEmotionEvents,
	retryScoring: apiMock.retryScoring,
}));

vi.mock("@/api/export", () => ({
	exportRecordDetail: apiMock.exportRecordDetail,
}));

vi.mock("@/hooks/useQuestionnaire", () => ({
	useQuestionnaire: () => ({
		checkResponse: null,
		isLoading: false,
		shouldShow: false,
		check: vi.fn(),
		submit: vi.fn(),
		dismiss: vi.fn(),
	}),
}));

const RECORD = {
	id: 9,
	case_id: 1,
	case_name: "慢阻肺急性加重",
	user_display_name: "李四",
	status: "completed",
	scoring_status: "completed",
	start_time: "2026-01-01T10:00:00",
	end_time: "2026-01-01T10:20:00",
	time_limit: 20,
	messages: [],
	patient_gender: "男",
	patient_name: "王五",
	patient_age: 60,
	case_title: "慢阻肺",
	chief_complaint: "咳嗽",
	from_assignment: false,
	pending_questionnaires: 0,
	initiative_count: 0,
	is_test: false,
	score: {
		total_score: 80,
		review_status: "reviewed",
		reviewed_by_name: "张老师",
		detail_scores: {
			沟通技能: { score: 20, max: 30, items: [{ name: "打招呼", score: 2, max: 3 }] },
		},
	},
};

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/admin/records/9"]}>
				<Routes>
					<Route path="/admin/records/:id" element={<TeacherRecordDetail />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	useAuthStore.setState({ permissions: ["score_review"] });
	apiMock.getRecordDetail.mockResolvedValue({ data: RECORD });
	apiMock.getEmotionEvents.mockResolvedValue([]);
	apiMock.exportRecordDetail.mockResolvedValue({ data: "文本" });
	Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:test"), writable: true });
	Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true });
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
	useAuthStore.setState({ permissions: [] });
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("教师详情页评分区按钮", () => {
	it("有评分权限时渲染复核入口，且不再有无实现的「查看详细评分」", async () => {
		renderPage();

		expect(await screen.findByRole("button", { name: /修改复核/ })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /查看详细评分/ })).not.toBeInTheDocument();
	});

	it("「导出记录」走真实导出接口", async () => {
		renderPage();

		await waitFor(() => expect(screen.getByRole("button", { name: /导出记录/ })).toBeInTheDocument());
		await screen.getByRole("button", { name: /导出记录/ }).click();

		await waitFor(() => expect(apiMock.exportRecordDetail).toHaveBeenCalledWith("9"));
	});
});
