import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setViewport } from "@/__tests__/setup";
import RecordDetail from "@/pages/RecordDetail";

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

const BASE_RECORD = {
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
	patient_name: "李四",
	patient_age: 60,
	case_title: "慢阻肺",
	chief_complaint: "咳嗽",
	from_assignment: false,
	pending_questionnaires: 0,
	initiative_count: 0,
	is_test: false,
	review_focus_note: "本次没有需要单独解释的关键条目；逐项表现与证据在下方可查。",
	score: {
		total_score: 80,
		detail_scores: {
			沟通技能: { score: 20, max: 30, items: [{ name: "打招呼", score: 2, max: 3, evidence: "您好" }] },
		},
	},
};

const FAILED_RECORD = BASE_RECORD;

/** 已复核记录：两层精度 + 关键选择 + 再练习入口 + 空反馈 */
const REVIEWED_RECORD = {
	...BASE_RECORD,
	scoring_status: "completed",
	scoring_error: null,
	messages: [{ id: 101, role: "student", content: "您好，我是实习护士小王" }],
	score: {
		total_score: 72,
		reviewed_total: 84,
		effective_total: 84,
		source: "review",
		review_status: "reviewed",
		reviewed_by_name: "王老师",
		reviewed_at: "2026-02-01T09:30:00",
		review_comment: "问诊顺序需要更严谨",
		review: { total_score: 84, comment: "问诊顺序需要更严谨", reviewed_at: "2026-02-01T09:30:00" },
		detail_scores: {
			沟通技能: {
				score: 20,
				max: 30,
				items: [{ id: "c1", name: "自我介绍", score: 3, max: 3, evidence: "您好，我是实习护士小王" }],
			},
		},
		raw_detail_scores: {
			沟通技能: {
				score: 3,
				max: 6,
				items: [
					{
						id: "c1",
						name: "自我介绍",
						score: 2,
						max: 2,
						status: "scored",
						evidence: "您好，我是实习护士小王",
						reason: "身份交代完整",
						evidence_refs: [{ kind: "message", id: 101, role: "student" }],
						evidence_verified: true,
					},
					{
						id: "c2",
						name: "核对患者身份",
						score: 0,
						max: 2,
						status: "scored",
						evidence: "核对姓名与床号",
						reason: "未执行查对",
						evidence_refs: [],
						evidence_verified: false,
					},
					{ id: "c3", name: "发热病史", score: null, max: 2, status: "not_applicable" },
					{ id: "c4", name: "用药史", score: null, max: 2, status: "unscored_by_model" },
				],
			},
		},
		strengths: [],
		weaknesses: [],
		missed_content: [],
		suggestions: "",
		feedback_note: "本次没有明显不足：完成度较高，主要问题在顺序",
		grade: {
			numeric_band: "good",
			numeric_band_label: "数值参考 · 高",
			capability_band: null,
			capability_label: "尚未校准能力等第",
			source: "review",
			policy: {
				id: "nursing_history_grade",
				version: 1,
				calibrated: false,
				capability_available: false,
				capability_label: "尚未校准能力等第",
				capability_note: "能力等第需要教师校准裁判例后才能启用；当前只提供量尺、逐项表现与反馈",
				numeric_bands: [
					{ band: "good", min: 85, label: "数值参考 · 高" },
					{ band: "medium", min: 60, label: "数值参考 · 中" },
				],
				numeric_band_description: "按展示分固定阈值分段，只描述数值位置，不代表能力等第",
			},
		},
	},
	review_focus: [
		{
			dimension: "沟通技能",
			item_id: "c2",
			item_name: "核对患者身份",
			score: 0,
			max: 2,
			kind: "missed",
			key_omission: true,
			evidence: "核对姓名与床号",
			evidence_refs: [],
			evidence_verified: false,
			reason: "未执行查对",
			principle: "给药与操作前先核对姓名、床号与腕带",
			typical_error: "跳过查对直接提问",
		},
	],
	practice_options: {
		remediation: {
			available: true,
			label: "同例纠正练习",
			case_id: 1,
			case_name: "慢阻肺急性加重",
			revision_changed: true,
			message: "该病例内容已更新，本次同例练习使用最新版本",
		},
		transfer: {
			available: false,
			label: "变式迁移练习",
			reason: "no_family_declared",
			message: "该病例未声明病例家族与迁移变式，暂不提供迁移练习",
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
					<Route path="/training/:recordId" element={<div>训练会话页</div>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	apiMock.getRecordDetail.mockResolvedValue({ data: FAILED_RECORD });
	apiMock.getEmotionEvents.mockResolvedValue([]);
	apiMock.retryScoring.mockResolvedValue({ data: { message: "ok", record_id: 7 } });
	apiMock.startPractice.mockResolvedValue({
		data: { record_id: 99, greeting: "你好", case_name: "慢阻肺急性加重", pending_questionnaires: 0 },
	});
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
	it("评分失败时「重新评分」确认后触发后端重试", async () => {
		renderPage();

		await userEvent.click(await screen.findByRole("button", { name: /重新评分/ }));

		const dialog = await screen.findByRole("dialog");
		await userEvent.click(within(dialog).getByRole("button", { name: "重新评分" }));

		await waitFor(() => expect(apiMock.retryScoring).toHaveBeenCalledWith("7", undefined));
	});

	it("「刷新状态」只重新拉取记录详情，不触发重新评分", async () => {
		apiMock.getRecordDetail.mockResolvedValue({
			data: { ...FAILED_RECORD, scoring_status: "processing", scoring_error: null },
		});
		renderPage();

		const callsBefore = apiMock.getRecordDetail.mock.calls.length;
		await userEvent.click(await screen.findByRole("button", { name: /刷新状态/ }));

		await waitFor(() => expect(apiMock.getRecordDetail.mock.calls.length).toBeGreaterThan(callsBefore));
		expect(apiMock.retryScoring).not.toHaveBeenCalled();
	});

	it("评分尚未出终态时自动轮询记录详情，并只显示不定态进度", async () => {
		apiMock.getRecordDetail.mockResolvedValue({
			data: { ...FAILED_RECORD, scoring_status: "processing", scoring_error: null },
		});
		renderPage();

		// 进度不可知：横幅只给"进行中"的不定态说明，不给任何百分比
		expect(await screen.findByText(/进度由后台异步任务决定，无法预估剩余时间/)).toBeInTheDocument();
		expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument();

		const callsBefore = apiMock.getRecordDetail.mock.calls.length;
		await waitFor(
			() => expect(apiMock.getRecordDetail.mock.calls.length).toBeGreaterThan(callsBefore),
			{ timeout: 8000 },
		);
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

describe("学生结果页：教师复核与成绩口径", () => {
	beforeEach(() => {
		apiMock.getRecordDetail.mockResolvedValue({ data: REVIEWED_RECORD });
	});

	it("教师复核真的到达学生页：AI 初评与教师复核分开标注，含复核人与备注", async () => {
		renderPage();

		expect(await screen.findByText("AI 初评")).toBeInTheDocument();
		expect(screen.getByText("教师复核")).toBeInTheDocument();
		// AI 初评分（72）与教师复核分（84）各自独立呈现，有效成绩 = 复核分
		expect(screen.getByText("72")).toBeInTheDocument();
		expect(screen.getAllByText("84").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText("有效成绩来源：教师复核")).toBeInTheDocument();
		expect(screen.getByText("问诊顺序需要更严谨")).toBeInTheDocument();
		expect(screen.getByText(/复核人: 王老师/)).toBeInTheDocument();
		expect(screen.queryByText(/AI 原始评分: /)).not.toBeInTheDocument();
	});

	it("成绩只按服务端给的分层口径呈现，并标注尚未校准能力等第", async () => {
		renderPage();

		expect(await screen.findByText("数值参考 · 高")).toBeInTheDocument();
		expect(screen.getAllByText("尚未校准能力等第").length).toBeGreaterThan(0);
		expect(screen.queryByText("优秀")).not.toBeInTheDocument();
		expect(screen.queryByText("合格")).not.toBeInTheDocument();
	});

	it("逐项判定用原始层：不适用 / 系统未判定 状态显式呈现", async () => {
		renderPage();

		expect(await screen.findByText("本次不适用")).toBeInTheDocument();
		expect(screen.getByText("系统未判定")).toBeInTheDocument();
		// 原始量尺 0..raw_scale（2 分制），不是展示层的换算分
		expect(screen.getByText("2/2")).toBeInTheDocument();
		expect(screen.getAllByText("0/2").length).toBeGreaterThan(0);
		expect(screen.getAllByText("—")).toHaveLength(2);
	});

	it("未定位成功的证据标注「未能定位证据」且不给跳转，定位成功的给跳转到对话", async () => {
		renderPage();

		// 未定位证据的条目（得分低于 60% 时默认展开）：如实标注，且没有跳转按钮
		expect((await screen.findAllByText("未能定位证据")).length).toBeGreaterThan(0);

		// 只有服务端定位成功（evidence_refs 含 message id）的条目才提供跳转
		expect(screen.getAllByRole("button", { name: "在对话回放中定位该证据" })).toHaveLength(1);
	});

	it("空反馈显示明确空态与解释，而不是隐藏整段", async () => {
		// 手机视口：分区默认折叠，"点开才看到空态"才是这条用例要验的交互
		setViewport(390, 844);
		renderPage();

		await userEvent.click(await screen.findByText("需要改善"));
		expect(await screen.findByText("本次无明确不足")).toBeInTheDocument();
		expect(screen.getByText("本次没有明显不足：完成度较高，主要问题在顺序")).toBeInTheDocument();

		await userEvent.click(screen.getByText("漏问内容"));
		expect(screen.getByText("本次无漏问")).toBeInTheDocument();
	});

	it("系统降级结果显式标注为降级，不冒充正常成绩", async () => {
		apiMock.getRecordDetail.mockResolvedValue({
			data: {
				...REVIEWED_RECORD,
				score: {
					...REVIEWED_RECORD.score,
					source: "fallback",
					fallback: { kind: "items_unscored", items: ["用药史"] },
					grade: {
						...REVIEWED_RECORD.score.grade,
						numeric_band: "medium",
						numeric_band_label: "数值参考 · 中",
						source: "fallback",
					},
				},
			},
		});
		renderPage();

		expect(await screen.findByText("评分由系统降级生成，不能当作正常成绩")).toBeInTheDocument();
		expect(screen.getByText(/部分条目未被模型判定/)).toBeInTheDocument();
		expect(screen.getByText(/未判定的条目：用药史/)).toBeInTheDocument();
		expect(screen.getByText(/有效成绩来源：系统降级/)).toBeInTheDocument();
	});
});

describe("学生结果页：关键选择与再练习", () => {
	beforeEach(() => {
		apiMock.getRecordDetail.mockResolvedValue({ data: REVIEWED_RECORD });
	});

	it("关键选择回看给出条目、原始分、漏问标记与下次练习原则", async () => {
		renderPage();

		expect(await screen.findByText("关键选择回看")).toBeInTheDocument();
		expect(screen.getByText("关键遗漏")).toBeInTheDocument();
		expect(screen.getByText(/下次练习原则：/)).toBeInTheDocument();
		expect(screen.getByText("给药与操作前先核对姓名、床号与腕带")).toBeInTheDocument();
		expect(screen.getByText(/常见错误：跳过查对直接提问/)).toBeInTheDocument();

		// 结果区顶部先是关键选择，其次才是完整评分明细
		const focusHeading = screen.getByText("关键选择回看");
		const scoreHeading = screen.getByText("评分结果");
		expect(
			focusHeading.compareDocumentPosition(scoreHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("再练习入口只渲染可用项，并发起 start-practice 后进入新记录", async () => {
		renderPage();

		const button = await screen.findByRole("button", { name: /同例纠正练习（病例内容已更新）/ });
		expect(screen.queryByRole("button", { name: /变式迁移练习/ })).not.toBeInTheDocument();

		await userEvent.click(button);

		await waitFor(() => expect(apiMock.startPractice).toHaveBeenCalledWith("7", "remediation"));
		expect(await screen.findByText("训练会话页")).toBeInTheDocument();
	});

	it("本记录自身的练习留痕会显示（含来源记录）", async () => {
		apiMock.getRecordDetail.mockResolvedValue({
			data: {
				...REVIEWED_RECORD,
				practice: { kind: "remediation", purpose: "同例纠正练习", source_record_id: 3, revision_changed: false },
			},
		});
		renderPage();

		expect(await screen.findByText(/同例纠正练习 · 源自 #3/)).toBeInTheDocument();
	});

	it("两个入口都不可用时整块不渲染（不给假入口）", async () => {
		apiMock.getRecordDetail.mockResolvedValue({
			data: {
				...REVIEWED_RECORD,
				practice_options: {
					remediation: { available: false, label: "同例纠正练习", reason: "case_not_open", message: "病例未开放" },
					transfer: { available: false, label: "变式迁移练习", reason: "no_family_declared", message: "无家族" },
				},
			},
		});
		renderPage();

		await screen.findByText("关键选择回看");
		expect(screen.queryByText("再练习")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /练习/ })).not.toBeInTheDocument();
	});
});
