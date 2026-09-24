import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordDetail from "@/pages/RecordDetail";

const apiMock = vi.hoisted(() => ({
	getRecordDetail: vi.fn(),
	getEmotionEvents: vi.fn(),
	retryScoring: vi.fn(),
	exportRecordDetail: vi.fn(),
	checkQuestionnaire: vi.fn(),
	submitQuestionnaire: vi.fn(),
}));

vi.mock("@/api/training", () => ({
	getRecordDetail: apiMock.getRecordDetail,
	getEmotionEvents: apiMock.getEmotionEvents,
	retryScoring: apiMock.retryScoring,
}));

vi.mock("@/api/export", () => ({
	exportRecordDetail: apiMock.exportRecordDetail,
}));

vi.mock("@/api/questionnaires", () => ({
	checkQuestionnaire: apiMock.checkQuestionnaire,
	submitQuestionnaire: apiMock.submitQuestionnaire,
}));

const FAILED_RECORD = {
	id: 7,
	case_id: 1,
	case_name: "慢阻肺急性加重",
	user_display_name: "张三",
	status: "completed",
	scoring_status: "failed",
	scoring_error: "LLM 超时",
	start_time: "2026-01-01T10:00:00",
	end_time: "2026-01-01T10:20:00",
	time_limit: 20,
	messages: [],
	patient_gender: "男",
	training_type: "history_taking",
	patient_name: "李四",
	patient_age: 60,
	case_title: "慢阻肺",
	chief_complaint: "咳嗽",
	from_assignment: false,
	pending_questionnaires: 0,
	initiative_count: 0,
	is_test: false,
	score: {
		total_score: 80,
		detail_scores: {
			沟通技能: { score: 20, max: 30, items: [{ name: "打招呼", score: 2, max: 3, evidence: "您好" }] },
		},
	},
};

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/record/7"]}>
				<Routes>
					<Route path="/record/:id" element={<RecordDetail />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	apiMock.getRecordDetail.mockResolvedValue({ data: FAILED_RECORD });
	apiMock.getEmotionEvents.mockResolvedValue([]);
	apiMock.retryScoring.mockResolvedValue({ data: { message: "ok", record_id: 7 } });
	apiMock.checkQuestionnaire.mockResolvedValue({ data: { has_pending: false } });
	apiMock.submitQuestionnaire.mockResolvedValue({ data: {} });
	apiMock.exportRecordDetail.mockResolvedValue({ data: "记录文本" });
	Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:test"), writable: true });
	Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true });
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("学生结果页操作按钮", () => {
	it("评分失败时「重新评分」真的触发后端重试", async () => {
		renderPage();

		const retryButton = await screen.findByRole("button", { name: /重新评分/ });
		await userEvent.click(retryButton);

		await waitFor(() => expect(apiMock.retryScoring).toHaveBeenCalledWith("7", undefined));
	});

	it("「导出记录」下载当前记录的导出文本", async () => {
		renderPage();

		await userEvent.click(await screen.findByRole("button", { name: /导出记录/ }));

		await waitFor(() => expect(apiMock.exportRecordDetail).toHaveBeenCalledWith("7"));
	});

	it("不再渲染无实现的空按钮（查看详细评分 / 复核评分）", async () => {
		renderPage();

		expect(await screen.findByText("评分结果")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /查看详细评分/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /复核评分/ })).not.toBeInTheDocument();
	});

	it("评分完成后在学生结果页触发训练后问卷", async () => {
		apiMock.getRecordDetail.mockResolvedValue({
			data: { ...FAILED_RECORD, scoring_status: "completed", scoring_error: null },
		});
		apiMock.checkQuestionnaire.mockResolvedValue({
			data: {
				has_pending: true,
				template_id: 9,
				is_required: true,
				trigger_event: "after_scoring",
				template: {
					id: 9,
					title: "训练后反馈",
					description: null,
					is_active: true,
					question_count: 1,
					response_count: 0,
					questions: [
						{
							id: 91,
							content: "本次训练是否有帮助？",
							question_type: "short_text",
							required: true,
							sort_order: 1,
							options: null,
						},
					],
				},
			},
		});

		renderPage();

		expect(await screen.findByText("训练后反馈")).toBeInTheDocument();
		expect(apiMock.checkQuestionnaire).toHaveBeenCalledWith({
			case_id: 1,
			record_id: 7,
			trigger: "after_scoring",
		});
	});
});
