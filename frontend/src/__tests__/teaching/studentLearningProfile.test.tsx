import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudentLearningProfile } from "@/api/scoreboard";
import { render } from "@/__tests__/render";
import { setViewport } from "@/__tests__/setup";
import StudentLearningProfilePage from "@/pages/teaching/StudentLearningProfilePage";

// 只替换网络边界：页面行为（加载/错误/空态、页签、跳详情）都跑真实组件。
const getStudentLearningProfile = vi.fn();

vi.mock("@/api/scoreboard", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/api/scoreboard")>();
	return { ...actual, getStudentLearningProfile: (...args: unknown[]) => getStudentLearningProfile(...args) };
});

const PROFILE: StudentLearningProfile = {
	student: {
		user_id: 42,
		display_name: "欧阳娜娜·阿不都热合曼·艾力",
		student_id: "2024010101",
		username: "stu-a",
		classes: [{ id: 7, name: "护理2401", cohort_label: "2026级", school_id: 1, school_name: "甲大学" }],
	},
	trend: {
		user_id: 42,
		display_name: "欧阳娜娜·阿不都热合曼·艾力",
		student_id: "2024010101",
		class_name: "护理2401",
		training_count: 2,
		total_duration_seconds: 3000,
		avg_score: 78,
		best_score: 86,
		first_score: 70,
		latest_score: 86,
		progress_delta: 16,
		progress_trend: "up",
		records: [
			{
				record_id: 1001,
				case_id: 3,
				case_name: "社区获得性肺炎",
				assignment_id: "a-1",
				assignment_title: "第三章 病史采集",
				score: 70,
				duration_seconds: 1500,
				start_time: "2026-11-01T02:00:00Z",
				end_time: "2026-11-01T02:25:00Z",
				comparability_label: "肺炎·100分",
			},
			{
				record_id: 1002,
				case_id: 3,
				case_name: "社区获得性肺炎",
				assignment_id: "a-1",
				assignment_title: "第三章 病史采集",
				score: 86,
				duration_seconds: 1500,
				start_time: "2026-11-02T02:00:00Z",
				end_time: "2026-11-02T02:25:00Z",
				comparability_label: "肺炎·100分",
			},
		],
		policy: {},
		comparability: { single_group: true, mixed: false, identity_unknown_count: 0, groups: [] },
	},
	assignments: [
		{
			assignment_id: "a-1",
			title: "第三章 病史采集",
			case_id: 3,
			case_name: "社区获得性肺炎",
			class_id: 7,
			class_name: "护理2401",
			start_time: "2026-11-01T00:00:00Z",
			end_time: "2026-11-08T00:00:00Z",
			lifecycle: "ended",
			status: "completed",
			attempt_count: 2,
			max_attempts: 3,
			record_id: 1002,
			score_total: 86,
			scoring_status: "completed",
			is_overdue: false,
		},
	],
	training: [
		{
			record_id: 1002,
			case_id: 3,
			case_name: "社区获得性肺炎",
			assignment_id: "a-1",
			assignment_title: "第三章 病史采集",
			status: "completed",
			scoring_status: "completed",
			score_reviewed: false,
			score_total: 86,
			score_source: "ai",
			score_degraded: false,
			start_time: "2026-11-02T02:00:00Z",
			end_time: "2026-11-02T02:25:00Z",
			duration_seconds: 1500,
			is_student_practice: true,
			is_overdue: false,
		},
	],
	training_total: 1,
	training_summary: { completed: 1, scored: 1, avg_score: 86, avg_duration_seconds: 1500 },
	training_offset: 0,
	training_limit: 20,
};

function LocationProbe() {
	const { pathname } = useLocation();
	return <div data-testid="record-route">{pathname}</div>;
}

function renderPage(initialEntry: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[initialEntry]}>
				<Routes>
					<Route path="/admin/students/:userId" element={<StudentLearningProfilePage />} />
					{/* 记录详情路由由父代理注册；这里用探头锁"跳去哪"而不是复制真实页面 */}
					<Route
						path="/admin/records/:id"
						element={<LocationProbe />}
					/>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("学生学习档案页", () => {
	beforeEach(() => {
		getStudentLearningProfile.mockReset();
	});

	it("加载态：请求在飞时给出可读的加载提示", async () => {
		getStudentLearningProfile.mockReturnValue(new Promise(() => {}));
		renderPage("/admin/students/42");
		expect(await screen.findByText("加载档案中…")).toBeInTheDocument();
	});

	it("错误态：透出服务端 detail 并可重试", async () => {
		getStudentLearningProfile.mockRejectedValue({ response: { data: { detail: "学生不存在" } } });
		renderPage("/admin/students/42");
		expect(await screen.findByText("学生不存在")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
	});

	it("移动端：窄屏下档案仍可读，表格横向滚动而不是撑破布局", async () => {
		setViewport(390, 844);
		getStudentLearningProfile.mockResolvedValue({ data: PROFILE });
		renderPage("/admin/students/42?tab=training");
		expect(await screen.findByText("社区获得性肺炎")).toBeInTheDocument();
		// 长姓名与表格都在，横向滚动容器由 TableScroll 提供（min-width 由表自己声明）
		expect(document.querySelector(".table-scroll")).not.toBeNull();
		setViewport(1280, 800);
	});

	it("非法学生 id：不发请求，给出可返回的空态", async () => {
		renderPage("/admin/students/abc");
		expect(await screen.findByText("学生参数不合法")).toBeInTheDocument();
		expect(getStudentLearningProfile).not.toHaveBeenCalled();
	});

	it("默认概览页签：长姓名完整展示，趋势与汇总可见", async () => {
		getStudentLearningProfile.mockResolvedValue({ data: PROFILE });
		renderPage("/admin/students/42");
		expect(
			(await screen.findAllByText("欧阳娜娜·阿不都热合曼·艾力")).length,
		).toBeGreaterThan(0);
		expect(screen.getByText(/学号 2024010101/)).toBeInTheDocument();
		// 概览渲染的是共享趋势视图（与排行弹窗同一份），不是页面自绘的另一套图
		expect(screen.getByText("训练次数")).toBeInTheDocument();
		expect(screen.getByText("分数趋势")).toBeInTheDocument();
	});

	it("URL 页签：?tab=assignments 直达作业列表，并可跳作业详情", async () => {
		getStudentLearningProfile.mockResolvedValue({ data: PROFILE });
		renderPage("/admin/students/42?tab=assignments");
		expect(await screen.findByText("第三章 病史采集")).toBeInTheDocument();
		expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
		expect(screen.getByRole("link", { name: "作业详情" })).toBeInTheDocument();
	});

	it("作业页签：代表记录进入教师记录详情", async () => {
		getStudentLearningProfile.mockResolvedValue({ data: PROFILE });
		renderPage("/admin/students/42?tab=assignments");
		// 记录详情的入口只有一个：作业行的代表记录与训练记录行都进 /admin/records/:id
		const link = await screen.findByRole("link", { name: /查看 .* 的教师记录详情/ });
		expect(link).toHaveAttribute("aria-label", "查看 第三章 病史采集 的教师记录详情");
		await userEvent.click(link);
		expect(await screen.findByTestId("record-route")).toHaveTextContent("/admin/records/1002");
	});

	it("训练记录页签：状态筛选写回 URL 并重置分页", async () => {
		getStudentLearningProfile.mockResolvedValue({ data: PROFILE });
		renderPage("/admin/students/42?tab=training&training_offset=20");
		expect(await screen.findByRole("combobox", { name: "按状态筛选训练记录" })).toBeInTheDocument();
		await waitFor(() => {
			expect(getStudentLearningProfile).toHaveBeenCalledWith(
				42,
				expect.objectContaining({ training_offset: 20, training_limit: 20 }),
			);
		});

		// 状态筛选是 URL 契约：`training_status` 进请求，且换状态必须回到第一页
		getStudentLearningProfile.mockClear();
		renderPage("/admin/students/42?tab=training&training_status=completed");
		await waitFor(() => {
			expect(getStudentLearningProfile).toHaveBeenCalledWith(
				42,
				expect.objectContaining({ training_status: "completed", training_offset: 0 }),
			);
		});
	});

	it("无训练学生：概览与训练页签都是空态而不是错误", async () => {
		getStudentLearningProfile.mockResolvedValue({
			data: {
				...PROFILE,
				trend: {
					...PROFILE.trend,
					training_count: 0,
					records: [],
					avg_score: null,
					best_score: null,
					first_score: null,
					latest_score: null,
					progress_delta: null,
					progress_trend: "none",
					total_duration_seconds: 0,
				},
				assignments: [],
				training: [],
				training_total: 0,
				training_summary: { completed: 0, scored: 0, avg_score: null, avg_duration_seconds: null },
			} satisfies StudentLearningProfile,
		});
		renderPage("/admin/students/42");
		expect(await screen.findByText("暂无成绩记录")).toBeInTheDocument();

		renderPage("/admin/students/42?tab=training");
		expect(await screen.findByText("暂无训练记录")).toBeInTheDocument();
	});

	it("作业为空：作业页签给出空态", async () => {
		getStudentLearningProfile.mockResolvedValue({ data: { ...PROFILE, assignments: [] } });
		renderPage("/admin/students/42?tab=assignments");
		expect(await screen.findByText("暂无作业")).toBeInTheDocument();
	});
});
