import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@/__tests__/render";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeacherRecordDetail from "@/pages/admin/TeacherRecordDetail";
import useAuthStore from "@/stores/authStore";

const apiMock = vi.hoisted(() => ({
	getRecordDetail: vi.fn(),
	getEmotionEvents: vi.fn(),
	retryScoring: vi.fn(),
	exportRecordDetail: vi.fn(),
	getRecordReview: vi.fn(),
	submitScoreReview: vi.fn(),
}));

vi.mock("@/api/training", () => ({
	getRecordDetail: apiMock.getRecordDetail,
	getEmotionEvents: apiMock.getEmotionEvents,
	retryScoring: apiMock.retryScoring,
	submitScoreReview: apiMock.submitScoreReview,
}));

vi.mock("@/api/training-review", () => ({
	getRecordReview: apiMock.getRecordReview,
	recordReviewQueryKey: (recordId: string) => ["training", "review", recordId],
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
	is_student_practice: true,
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

/** `GET /records/{id}/review`：原始量尺层（0–2），含一条本次不适用 */
const RAW_REVIEW = {
	score_id: 77,
	review_status: "pending",
	reviewed_by_name: null,
	reviewed_at: null,
	original_detail_scores: {
		沟通技能: { score: 60, max: 100, items: [{ id: "comm_01", name: "打招呼", score: 3, max: 5 }] },
	},
	original_raw_detail_scores: {
		沟通技能: {
			score: 2,
			max: 28,
			items: [
				{
					id: "comm_01",
					name: "打招呼",
					score: 2,
					max: 2,
					status: "scored",
					evidence: "学生：您好",
					reason: "主动问候",
				},
				{ id: "comm_02", name: "核对信息", score: null, max: 2, status: "not_applicable" },
			],
		},
	},
	review_detail_scores: null,
	review_total_score: null,
	review_comment: null,
	applicable_raw_max: 26,
	raw_scale: 2,
	review_basis: "score_meta",
	not_applicable_items: ["comm_02"],
};

describe("教师工作台的成绩来源", () => {
	it("AI 初评 / 教师复核 / 有效成绩来源分开呈现", async () => {
		apiMock.getRecordDetail.mockResolvedValue({
			data: {
				...RECORD,
				score: {
					...RECORD.score,
					reviewed_total: 72,
					effective_total: 72,
					source: "review",
					review: { total_score: 72, detail_scores: {}, comment: "调整判定", reviewed_at: "2026-02-01T10:00:00" },
				},
			},
		});
		renderPage();

		expect(await screen.findByText("教师复核")).toBeInTheDocument();
		// 逐项行也带来源徽章，因此 "AI 初评" 不只出现一次
		expect((await screen.findAllByText("AI 初评")).length).toBeGreaterThan(0);
		expect(screen.getByText(/有效成绩来源：教师复核/)).toBeInTheDocument();
		// 有效成绩与教师复核值同源（复核分优先）→ 两处都显示 72
		expect(screen.getAllByText("72").length).toBeGreaterThan(0);
	});

	it("系统降级结果明确标为不可当成绩，不静默显示成有效分", async () => {
		apiMock.getRecordDetail.mockResolvedValue({
			data: {
				...RECORD,
				score: {
					...RECORD.score,
					review_status: null,
					fallback: { kind: "dims_injected", dims: ["沟通技能"] },
					source: "fallback",
					effective_total: 80,
				},
			},
		});
		renderPage();

		expect(await screen.findByText(/不能当作正常成绩/)).toBeInTheDocument();
		expect(screen.getByText(/有效成绩来源：系统降级/)).toBeInTheDocument();
	});
});

describe("教师复核编辑器（原始条目层）", () => {
	it("按原始量尺编辑：不适用条目标为「本次不适用」且没有分值按钮", async () => {
		apiMock.getRecordReview.mockResolvedValue({ data: RAW_REVIEW });
		renderPage();

		fireEvent.click(await screen.findByRole("button", { name: /修改复核/ }));

		// 「核对信息」只存在于复核编辑器的原始层（展示层只有「打招呼」），用它等基准到达
		expect(await screen.findByText("核对信息")).toBeInTheDocument();
		expect(screen.getAllByText("打招呼").length).toBeGreaterThan(0);
		expect(screen.getByText("本次不适用")).toBeInTheDocument();
		// raw_scale=2 → 按钮只有 0/1/2；展示层（item.max=5）会出现 5
		expect(screen.queryByRole("button", { name: "5" })).not.toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "2" })).toHaveLength(1);
	});

	it("复核基准由展示层反推时给出「不是原始量尺」警示", async () => {
		apiMock.getRecordReview.mockResolvedValue({
			data: { ...RAW_REVIEW, review_basis: "legacy_display_derived" },
		});
		renderPage();

		fireEvent.click(await screen.findByRole("button", { name: /修改复核/ }));

		expect(await screen.findByText(/复核基准不是原始量尺/)).toBeInTheDocument();
		expect(screen.getByText(/由展示分反推/)).toBeInTheDocument();
	});

	it("提交复核发送原始条目（max=raw_scale，不适用条目为 null）", async () => {
		apiMock.getRecordReview.mockResolvedValue({ data: RAW_REVIEW });
		apiMock.submitScoreReview.mockResolvedValue({ data: { score_id: 77 } });
		renderPage();

		fireEvent.click(await screen.findByRole("button", { name: /修改复核/ }));
		await screen.findByText("核对信息");
		fireEvent.click(await screen.findByRole("button", { name: "1" }));
		fireEvent.click(screen.getByRole("button", { name: "提交复核" }));

		await waitFor(() => expect(apiMock.submitScoreReview).toHaveBeenCalledTimes(1));
		const [recordId, body] = apiMock.submitScoreReview.mock.calls[0];
		expect(recordId).toBe("9");
		const dimKey = "沟通技能";
		expect(body.detail_scores[dimKey].items).toEqual([
			{ id: "comm_01", name: "打招呼", score: 1, max: 2 },
			{ id: "comm_02", name: "核对信息", score: null, max: 2 },
		]);
	});
});
