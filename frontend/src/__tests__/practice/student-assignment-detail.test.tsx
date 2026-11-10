/**
 * 学生作业详情 —— 消费者可见的行为。
 *
 * 两件事分别锁：
 *  ① 主 CTA 决策：给什么作业状态 → 学生能做什么（这是「能不能开始」的唯一口径）；
 *  ② 页面渲染：加载/错误/空尝试/长文本/隐藏病例在屏幕上真的长成什么样。
 *
 * 不锁组件内部结构、不锁按钮实现细节，只断言学生看到的文案与可执行的动作。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import type * as coreApi from "@/api";
import type * as assignmentsApi from "@/api/assignments";
import type { StudentAssignmentDetail } from "@/api/assignments";
import {
	attemptRuleLabel,
	isAssignmentLocked,
	modeLabel,
	requiredActivitiesLabel,
	requiredArtifactsLabel,
	resolveAssignmentAction,
	timeLimitLabel,
} from "@/pages/practice/assignment-action";

const baseDetail = (over: Partial<StudentAssignmentDetail> = {}): StudentAssignmentDetail => ({
	id: "a-1",
	title: "第三章 病史采集",
	description: "请按护理程序完成完整病史采集。",
	case_id: 1,
	case_name: "社区获得性肺炎",
	hide_case_info: false,
	class_id: 2,
	class_name: "护理2401",
	teacher_name: "王老师",
	start_time: "2026-11-01T00:00:00+08:00",
	end_time: "2026-11-30T23:59:59+08:00",
	lifecycle: "active",
	status: "not_started",
	mode: "guided",
	max_attempts: 2,
	attempt_count: 0,
	remaining_attempts: 2,
	record_id: null,
	attempts: [],
	time_limit_minutes: 20,
	required_activities: [],
	required_artifacts: [],
	...over,
});

describe("作业主行动决策", () => {
	it("未开始 → 开始练习", () => {
		const action = resolveAssignmentAction(baseDetail());
		expect(action.kind).toBe("start");
		expect(action.label).toBe("开始练习");
		expect(action.isRetry).toBe(false);
	});

	it("进行中 → 继续那条记录，而不是新开一次", () => {
		const action = resolveAssignmentAction(
			baseDetail({ status: "in_progress", record_id: 42, attempt_count: 0, remaining_attempts: 2 }),
		);
		expect(action.kind).toBe("resume");
		expect(action.recordId).toBe(42);
	});

	it("进行中即使次数已用完也允许继续（在途记录不消耗次数）", () => {
		const action = resolveAssignmentAction(
			baseDetail({ status: "in_progress", record_id: 7, attempt_count: 2, remaining_attempts: 0 }),
		);
		expect(action.kind).toBe("resume");
	});

	it("已完成且还有次数 → 再练一次，并告知剩余次数", () => {
		const action = resolveAssignmentAction(
			baseDetail({ status: "completed", attempt_count: 1, remaining_attempts: 1, record_id: 9 }),
		);
		expect(action.kind).toBe("start");
		expect(action.isRetry).toBe(true);
		expect(action.hint).toContain("1");
	});

	it("已完成且次数用完 → 只能看复盘", () => {
		const action = resolveAssignmentAction(
			baseDetail({ status: "completed", attempt_count: 2, remaining_attempts: 0, record_id: 9 }),
		);
		expect(action.kind).toBe("review");
		expect(action.recordId).toBe(9);
		expect(action.hint).toContain("最大尝试次数");
	});

	it("不限次数时完成后仍可再练", () => {
		const action = resolveAssignmentAction(
			baseDetail({
				status: "completed",
				max_attempts: null,
				remaining_attempts: null,
				attempt_count: 5,
				record_id: 3,
			}),
		);
		expect(action.kind).toBe("start");
		expect(action.hint).toBeNull();
	});

	it("教师关闭后不能再开始，但仍看得到历史解释", () => {
		const action = resolveAssignmentAction(
			baseDetail({ lifecycle: "closed", status: "closed", record_id: 5, attempt_count: 1 }),
		);
		expect(action.kind).toBe("none");
		expect(action.hint).toContain("教师已关闭");
	});

	it("过了截止时间不能再开始", () => {
		const action = resolveAssignmentAction(baseDetail({ lifecycle: "ended", status: "overdue" }));
		expect(action.kind).toBe("none");
		expect(action.hint).toContain("截止");
	});

	it("关闭优先于截止时间（服务端同序）", () => {
		expect(isAssignmentLocked({ lifecycle: "closed" })).toBe(true);
		expect(isAssignmentLocked({ lifecycle: "ended" })).toBe(true);
		expect(isAssignmentLocked({ lifecycle: "active" })).toBe(false);
	});
});

describe("作业文案（训练方式 / 尝试规则）", () => {
	it("训练方式按服务端枚举给人话，未知值有兜底而不是空白", () => {
		expect(modeLabel("guided")).toBe("引导式练习");
		expect(modeLabel("assessment")).toBe("考核式练习");
		expect(modeLabel("")).toBe("标准练习");
		expect(modeLabel("something_new")).toBe("标准练习");
	});

	it("有限次数同时给出上限与已用", () => {
		expect(attemptRuleLabel({ max_attempts: 3, attempt_count: 1 })).toBe("最多 3 次（已用 1 次）");
	});

	it("0 与 null 都表示不限次数", () => {
		expect(attemptRuleLabel({ max_attempts: 0, attempt_count: 2 })).toContain("不限次数");
		expect(attemptRuleLabel({ max_attempts: null, attempt_count: 2 })).toContain("不限次数");
	});
});

// ── 页面渲染 ──

const { getStudentAssignmentMock } = vi.hoisted(() => ({ getStudentAssignmentMock: vi.fn() }));

vi.mock("@/api/assignments", async (importOriginal) => {
	const actual = await importOriginal<typeof assignmentsApi>();
	return {
		...actual,
		getStudentAssignment: getStudentAssignmentMock,
		startAssignment: vi.fn(),
	};
});

vi.mock("@/api", async (importOriginal) => {
	const actual = await importOriginal<typeof coreApi>();
	return { ...actual, abandonRecord: vi.fn() };
});

import StudentAssignmentDetailPage from "@/pages/practice/StudentAssignmentDetailPage";

function renderPage(path = "/assignments/a-1") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route path="/assignments/:id" element={<StudentAssignmentDetailPage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("学生作业详情页渲染", () => {
	it("展示作业要求、训练方式与尝试规则（未开始时空态可读）", async () => {
		getStudentAssignmentMock.mockResolvedValue({ data: baseDetail() });
		renderPage();

		await waitFor(() => expect(screen.getByText("第三章 病史采集")).toBeInTheDocument());
		expect(screen.getByText("请按护理程序完成完整病史采集。")).toBeInTheDocument();
		// 病例/班级各在标题副行与「作业信息」里各出现一次（同一份数据的两种呈现）
		expect(screen.getAllByText("社区获得性肺炎").length).toBeGreaterThan(0);
		expect(screen.getAllByText("护理2401").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: /开始练习/ })).toBeInTheDocument();
		// 空尝试：明确的空态，而不是一片白
		expect(screen.getAllByText("还没有尝试记录").length).toBeGreaterThan(0);
	});

	it("长文本完整显示（不截断）", async () => {
		const long = "请按护理程序完成完整病史采集。".repeat(40);
		getStudentAssignmentMock.mockResolvedValue({ data: baseDetail({ description: long }) });
		renderPage();

		await waitFor(() => expect(screen.getByText(long)).toBeInTheDocument());
	});

	it("隐藏病例的作业不显示病例名", async () => {
		getStudentAssignmentMock.mockResolvedValue({
			data: baseDetail({ hide_case_info: true, case_name: "", mode: "assessment", description: null }),
		});
		renderPage();

		await waitFor(() => expect(screen.getByText("隐藏病例")).toBeInTheDocument());
		// 标题副行用中性文案替代病例名
		expect(screen.getAllByText("隐藏病例练习").length).toBeGreaterThan(0);
		expect(screen.queryByText("社区获得性肺炎")).not.toBeInTheDocument();
		expect(screen.getByText("教师没有填写额外说明。")).toBeInTheDocument();
	});

	it("404 时给出「找不到这个作业」而不是通用报错", async () => {
		getStudentAssignmentMock.mockRejectedValue({ status: 404 });
		renderPage();

		await waitFor(() => expect(screen.getByText("找不到这个作业")).toBeInTheDocument());
		expect(screen.getByRole("button", { name: "返回作业列表" })).toBeInTheDocument();
	});

	it("其他错误给失败态与重试入口", async () => {
		getStudentAssignmentMock.mockRejectedValue({ status: 500 });
		renderPage();

		await waitFor(() => expect(screen.getByText("加载失败")).toBeInTheDocument());
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
	});

	it("已有尝试时列出每条记录与分数", async () => {
		getStudentAssignmentMock.mockResolvedValue({
			data: baseDetail({
				status: "completed",
				attempt_count: 2,
				remaining_attempts: 0,
				record_id: 12,
				attempts: [
					{
						record_id: 12,
						status: "completed",
						scoring_status: "completed",
						score_total: 88,
						is_overdue: false,
						start_time: "2026-11-02T10:00:00+08:00",
						end_time: "2026-11-02T10:30:00+08:00",
					},
					{
						record_id: 11,
						status: "completed",
						scoring_status: "failed",
						score_total: null,
						is_overdue: true,
						start_time: "2026-11-01T10:00:00+08:00",
						end_time: "2026-11-01T10:30:00+08:00",
					},
				],
			}),
		});
		renderPage();

		// 宽/窄屏两种排布都渲染同一份尝试数据（可见性由 CSS 控制），因此按多元素断言
		await waitFor(() => expect(screen.getAllByText("88 分").length).toBeGreaterThan(0));
		// 评分失败 ≠ 0 分
		expect(screen.getAllByText("评分失败").length).toBeGreaterThan(0);
		expect(screen.getAllByText("逾期提交").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: /查看复盘/ })).toBeInTheDocument();
	});
});

describe("公开训练要求文案（预计时限 / 操作 / 必交内容）", () => {
	it("时限按分钟展示，缺失时不编造默认值", () => {
		expect(timeLimitLabel(30)).toBe("30 分钟");
		expect(timeLimitLabel(null)).toBe("—");
		expect(timeLimitLabel(0)).toBe("—");
	});

	it("无必交产物时明确显示「无额外必交」而不是留空", () => {
		expect(requiredArtifactsLabel([])).toBe("无额外必交（结束训练即可交卷）");
	});

	it("有必交产物时列出标签，未知标签回落到 kind", () => {
		expect(requiredArtifactsLabel([{ kind: "nursing_record", label: "护理记录" }])).toBe("护理记录");
		expect(requiredArtifactsLabel([{ kind: "mystery", label: "" }])).toBe("mystery");
	});

	it("需要完成的操作来自服务端标签，空列表有可读兜底", () => {
		expect(
			requiredActivitiesLabel([
				{ id: "physical_exam", label: "床旁检查" },
				{ id: "nursing_record", label: "护理记录" },
			]),
		).toBe("床旁检查、护理记录");
		expect(requiredActivitiesLabel([])).toBe("以对话完成护理评估");
	});
});

describe("学生作业详情页：训练要求展示", () => {
	it("在作业信息中展示预计时限与必交内容", async () => {
		getStudentAssignmentMock.mockResolvedValue({
			data: baseDetail({
				time_limit_minutes: 45,
				required_activities: [{ id: "physical_exam", label: "床旁检查" }],
				required_artifacts: [{ kind: "nursing_record", label: "护理记录" }],
			}),
		});
		renderPage();

		await waitFor(() => expect(screen.getByText("预计时限")).toBeInTheDocument());
		expect(screen.getByText("45 分钟")).toBeInTheDocument();
		expect(screen.getByText("必交内容")).toBeInTheDocument();
		expect(screen.getByText("护理记录")).toBeInTheDocument();
		expect(screen.getByText("床旁检查")).toBeInTheDocument();
	});

	it("没有额外必交时明确说明，不留空白", async () => {
		getStudentAssignmentMock.mockResolvedValue({ data: baseDetail() });
		renderPage();

		await waitFor(() => expect(screen.getByText("必交内容")).toBeInTheDocument());
		expect(screen.getByText("无额外必交（结束训练即可交卷）")).toBeInTheDocument();
		expect(screen.getByText("以对话完成护理评估")).toBeInTheDocument();
	});
});
