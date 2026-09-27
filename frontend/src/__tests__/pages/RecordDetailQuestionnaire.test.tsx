import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordDetail from "@/pages/RecordDetail";

/**
 * 训练后问卷（研究主结局）在学生结果页的三种情形 —— 严格区分，任何一种失败都不许静默：
 * ① has_pending=false → 什么都不显示（不能误报）；
 * ② has_pending=true + 题目就绪 → 弹窗；
 * ③ has_pending=true + 题目拿不到 → 可见提示 + 可重试（不能静默消失被误判成「学生跳过」）。
 * 另：check 自身失败也要可见但不阻塞成绩；提交失败必须可见且弹窗不关闭。
 */
const apiMock = vi.hoisted(() => ({
	getRecordDetail: vi.fn(),
	getEmotionEvents: vi.fn(),
	retryScoring: vi.fn(),
	startPractice: vi.fn(),
	exportRecordDetail: vi.fn(),
	checkQuestionnaire: vi.fn(),
	submitQuestionnaire: vi.fn(),
}));

vi.mock("@/api/training", () => ({
	getRecordDetail: apiMock.getRecordDetail,
	getEmotionEvents: apiMock.getEmotionEvents,
	retryScoring: apiMock.retryScoring,
	startPractice: apiMock.startPractice,
}));

vi.mock("@/api/export", () => ({
	exportRecordDetail: apiMock.exportRecordDetail,
}));

vi.mock("@/api/questionnaires", () => ({
	checkQuestionnaire: apiMock.checkQuestionnaire,
	submitQuestionnaire: apiMock.submitQuestionnaire,
}));

/** 评分已完成（训练后问卷的前置条件），其余字段与线上记录同形 */
const RECORD = {
	id: 7,
	case_id: 1,
	case_name: "慢阻肺急性加重",
	user_display_name: "张三",
	status: "completed",
	scoring_status: "completed",
	scoring_error: null,
	start_time: "2026-01-01T10:00:00",
	end_time: "2026-01-01T10:20:00",
	time_limit: 20,
	messages: [],
	patient_gender: "男",
	patient_name: "李四",
	patient_age: 60,
	case_title: "慢阻肺",
	chief_complaint: "咳嗽",
	from_assignment: false,
	pending_questionnaires: 1,
	initiative_count: 0,
	is_student_practice: true,
	review_focus_note: "本次没有需要单独解释的关键条目。",
	score: {
		total_score: 80,
		detail_scores: {
			沟通技能: { score: 20, max: 30, items: [{ name: "打招呼", score: 2, max: 3, evidence: "您好" }] },
		},
	},
};

const TEMPLATE = {
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
};

/** 服务端说有待答，但模板取不到（template_id 在、template 为 null） */
const PENDING_NO_TEMPLATE = {
	has_pending: true,
	template_id: 9,
	template: null,
	is_required: true,
	trigger_event: "after_scoring",
};

const PENDING_READY = {
	has_pending: true,
	template_id: 9,
	template: TEMPLATE,
	is_required: true,
	trigger_event: "after_scoring",
};

const NO_PENDING = { has_pending: false, is_required: false, trigger_event: "after_scoring" };

// tsconfig 的 lib 停在 ES2022（没有 Promise.withResolvers 的类型），沿用仓内既有写法
const promiseConstructor = Promise as unknown as {
	withResolvers<T>(): {
		promise: Promise<T>;
		resolve: (value: T) => void;
		reject: (reason?: unknown) => void;
	};
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
	apiMock.getRecordDetail.mockResolvedValue({ data: RECORD });
	apiMock.getEmotionEvents.mockResolvedValue([]);
	apiMock.retryScoring.mockResolvedValue({ data: { message: "ok", record_id: 7 } });
	apiMock.startPractice.mockResolvedValue({
		data: { record_id: 99, greeting: "你好", case_name: "慢阻肺急性加重", pending_questionnaires: 0 },
	});
	apiMock.exportRecordDetail.mockResolvedValue({ data: "记录文本" });
	apiMock.checkQuestionnaire.mockResolvedValue({ data: NO_PENDING });
	apiMock.submitQuestionnaire.mockResolvedValue({ data: {} });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("学生结果页 · 训练后问卷可见性", () => {
	it("情形③：有待答但题目拿不到 → 可见提示而不是静默消失，重试会重新发起请求", async () => {
		// 第一次 check 拿不到模板；点重试后服务端给出模板 —— 用来证明重试真的重发了请求
		let templateAvailable = false;
		apiMock.checkQuestionnaire.mockImplementation(() =>
			Promise.resolve({
				data: { ...PENDING_NO_TEMPLATE, template: templateAvailable ? TEMPLATE : null },
			}),
		);

		renderPage();

		expect(await screen.findByText("问卷加载失败")).toBeInTheDocument();
		expect(screen.getByText(/你的作答尚未被记录/)).toBeInTheDocument();
		// 题目拿不到时不开空弹窗（不是"看起来什么都没有"）
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

		const callsBeforeRetry = apiMock.checkQuestionnaire.mock.calls.length;
		templateAvailable = true;
		await userEvent.click(screen.getByRole("button", { name: "重试" }));

		expect(await screen.findByText("训练后反馈")).toBeInTheDocument();
		expect(apiMock.checkQuestionnaire.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
		await waitFor(() => expect(screen.queryByText("问卷加载失败")).not.toBeInTheDocument());
	});

	it("情形①：服务端明确无待答 → 不出现任何问卷提示（不误报）", async () => {
		const checkGate = promiseConstructor.withResolvers<{ data: typeof NO_PENDING }>();
		apiMock.checkQuestionnaire.mockImplementation(() => checkGate.promise);

		renderPage();

		// 先把结果页等出来，并确认 check 真的发出去了，否则下面的"什么都没有"是假通过
		expect(await screen.findByText("评分结果")).toBeInTheDocument();
		await waitFor(() => expect(apiMock.checkQuestionnaire).toHaveBeenCalled());
		expect(screen.queryByText("问卷加载失败")).not.toBeInTheDocument();

		await act(async () => {
			checkGate.resolve({ data: NO_PENDING });
		});

		expect(screen.queryByText("问卷加载失败")).not.toBeInTheDocument();
		expect(screen.queryByText("问卷状态获取失败")).not.toBeInTheDocument();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
	});

	it("情形②：有待答且题目就绪 → 弹窗可作答；提交失败保持可见且弹窗不关闭", async () => {
		apiMock.checkQuestionnaire.mockResolvedValue({ data: PENDING_READY });
		apiMock.submitQuestionnaire.mockRejectedValueOnce(new Error("500"));

		renderPage();

		expect(await screen.findByText("训练后反馈")).toBeInTheDocument();
		await userEvent.type(screen.getByPlaceholderText("请输入您的回答..."), "有帮助");

		const checkCallsBeforeSubmit = apiMock.checkQuestionnaire.mock.calls.length;
		await userEvent.click(screen.getByRole("button", { name: "提交" }));

		expect(await screen.findByText("提交失败，请重试")).toBeInTheDocument();
		// 弹窗不关闭、作答不丢、也没有推进流程（不重新 check）
		expect(screen.getByText(/本次训练是否有帮助/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "提交" })).toBeInTheDocument();
		expect(apiMock.checkQuestionnaire.mock.calls.length).toBe(checkCallsBeforeSubmit);
	});

	it("check 请求失败 → 可见提示与重试，且不阻塞成绩与其余内容渲染", async () => {
		apiMock.checkQuestionnaire.mockRejectedValue(new Error("network"));

		renderPage();

		expect(await screen.findByText("问卷状态获取失败")).toBeInTheDocument();
		// 不阻塞学习：成绩与导出等其余内容照常渲染
		expect(screen.getByText("评分结果")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /导出记录/ })).toBeInTheDocument();

		const callsBeforeRetry = apiMock.checkQuestionnaire.mock.calls.length;
		apiMock.checkQuestionnaire.mockResolvedValue({ data: NO_PENDING });
		await userEvent.click(screen.getByRole("button", { name: "重试" }));

		await waitFor(() => expect(apiMock.checkQuestionnaire.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
		await waitFor(() => expect(screen.queryByText("问卷状态获取失败")).not.toBeInTheDocument());
	});
});
