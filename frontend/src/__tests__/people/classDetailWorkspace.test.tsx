import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassDetailPage from "@/pages/people/ClassDetailPage";
import { fireEvent, render, screen, waitFor } from "../render";

const mocks = vi.hoisted(() => ({
	getClass: vi.fn(),
	getClassMembers: vi.fn(),
	getClassSummary: vi.fn(),
	getAssignments: vi.fn(),
	getRecords: vi.fn(),
}));

vi.mock("@/api/classes", () => ({
	getClass: mocks.getClass,
	getClassMembers: mocks.getClassMembers,
	getClassSummary: mocks.getClassSummary,
}));
vi.mock("@/api/assignments", () => ({ getAssignments: mocks.getAssignments }));
vi.mock("@/api/training", () => ({ getRecords: mocks.getRecords }));
// 成员行的附加信息是另一个请求，本用例只关心花名册本身
vi.mock("@/components/admin/classes/MemberAffiliations", () => ({
	default: () => null,
}));
vi.mock("@/components/admin/classes/AddMembersDialog", () => ({
	default: () => null,
}));

const CLASS = {
	id: 7,
	name: "2026 级护理一班",
	school_id: 1,
	school_name: "示例护理学院",
	cohort_label: "2026 级",
	student_count: 2,
	teacher_count: 1,
	assignment_count: 1,
	created_at: "2026-09-01T00:00:00Z",
};

const MEMBERS = {
	items: [
		{
			user_id: 11,
			username: "liyan",
			display_name: "李燕",
			student_id: "2026001",
			member_role: "student",
			joined_at: "2026-09-02T00:00:00Z",
		},
	],
	total: 1,
};

/** 记录地址栏的探针：让「页签/分页进 URL」可以被断言，而不是只看界面。 */
let seenSearch = "";
function LocationProbe() {
	const location = useLocation();
	seenSearch = location.search;
	return null;
}

function renderPage(entry = "/admin/classes/7") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[entry]}>
				<LocationProbe />
				<Routes>
					<Route path="/admin/classes/:classId" element={<ClassDetailPage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("班级工作台：页签写进 URL，刷新/返回保持同一视图", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seenSearch = "";
		mocks.getClass.mockResolvedValue({ data: CLASS });
		mocks.getClassSummary.mockResolvedValue({
			data: [
				{
					class_id: 7,
					class_name: CLASS.name,
					cohort_label: CLASS.cohort_label,
					student_count: 2,
					avg_score: 82.4,
					completion_rate: 75,
					total_sessions: 12,
					total_minutes: 340,
				},
			],
		});
		mocks.getClassMembers.mockResolvedValue({ data: MEMBERS });
		mocks.getAssignments.mockResolvedValue({
			data: {
				items: [
					{
						id: "a-1",
						title: "入院评估练习",
						case_name: "急性心梗",
						class_name: CLASS.name,
						teacher_name: "王老师",
						start_time: "2026-09-01T00:00:00Z",
						end_time: "2026-12-01T00:00:00Z",
						audience_mode: "class",
						student_count: 2,
						completed_count: 1,
						created_at: "2026-08-30T00:00:00Z",
						is_closed: false,
					},
				],
				total: 1,
			},
		});
		mocks.getRecords.mockResolvedValue({
			data: {
				items: [
					{
						id: 501,
						case_id: 3,
						case_name: "急性心梗",
						user_id: 11,
						user_display_name: "李燕",
						user_student_id: "2026001",
						score_reviewed: false,
						status: "completed",
						start_time: "2026-09-10T01:00:00Z",
						end_time: "2026-09-10T01:20:00Z",
						score_total: 85,
						score_degraded: false,
						is_student_practice: true,
					},
				],
				total: 1,
			},
		});
	});

	it("默认落在概览页签，不把默认值写进 URL", async () => {
		renderPage();
		expect(await screen.findByRole("heading", { name: /2026 级护理一班/ })).toBeVisible();
		expect(screen.getByRole("tab", { name: /概览/ })).toHaveAttribute("aria-selected", "true");
		await waitFor(() => expect(seenSearch).toBe(""));
	});

	it("非法 tab 值回落到概览而不是空白页", async () => {
		renderPage("/admin/classes/7?tab=bogus");
		expect(await screen.findByRole("tab", { name: /概览/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("切到成员页签写入 ?tab=members，并渲染花名册", async () => {
		renderPage();
		fireEvent.click(await screen.findByRole("tab", { name: /成员/ }));
		await waitFor(() => expect(seenSearch).toContain("tab=members"));
		expect(await screen.findByText("李燕")).toBeVisible();
		// 花名册请求必须带 URL 驱动的角色与分页
		await waitFor(() =>
			expect(mocks.getClassMembers).toHaveBeenCalledWith(
				7,
				expect.objectContaining({ role: "student", offset: 0, limit: 20 }),
			),
		);
	});

	it("成员搜索写入 URL（member_search），并清掉页码", async () => {
		renderPage("/admin/classes/7?tab=members&member_offset=20");
		const search = await screen.findByPlaceholderText("搜索姓名、用户名或学号...");
		fireEvent.change(search, { target: { value: "李" } });
		await waitFor(() => expect(seenSearch).toContain("member_search=%E6%9D%8E"));
		await waitFor(() => expect(seenSearch).not.toContain("member_offset"));
	});

	it("成员页签从 URL 恢复角色与页码（刷新保持）", async () => {
		renderPage("/admin/classes/7?tab=members&member_role=teacher&member_offset=40");
		expect(await screen.findByRole("tab", { name: /教师/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await waitFor(() =>
			expect(mocks.getClassMembers).toHaveBeenCalledWith(
				7,
				expect.objectContaining({ role: "teacher", offset: 40 }),
			),
		);
	});

	it("作业页签展示真实作业与完成率，并可下钻", async () => {
		renderPage("/admin/classes/7?tab=assignments");
		expect(await screen.findByText("入院评估练习")).toBeVisible();
		expect(screen.getByText("1/2")).toBeVisible();
		expect(mocks.getAssignments).toHaveBeenCalledWith(
			expect.objectContaining({ class_id: 7, offset: 0 }),
		);
		expect(
			screen.getByRole("link", { name: "入院评估练习" }),
		).toHaveAttribute("href", "/admin/assignments/a-1");
	});

	it("记录页签只拉学生练习，展示学生/病例/得分并可下钻", async () => {
		renderPage("/admin/classes/7?tab=records");
		expect(await screen.findByText("急性心梗")).toBeVisible();
		expect(mocks.getRecords).toHaveBeenCalledWith(
			expect.objectContaining({ class_id: 7, only_student_practice: true, offset: 0 }),
		);
		expect(screen.getByRole("link", { name: "李燕" })).toHaveAttribute(
			"href",
			"/admin/students/11",
		);
		expect(screen.getByText("85分")).toBeVisible();
		expect(screen.getByRole("link", { name: "急性心梗" })).toHaveAttribute(
			"href",
			"/admin/records/501",
		);
	});

	it("记录状态筛选进 URL 并回第一页", async () => {
		renderPage("/admin/classes/7?tab=records&record_offset=20");
		const select = await screen.findByLabelText("按状态筛选训练记录", {
			selector: "select",
		});
		fireEvent.change(select, { target: { value: "completed" } });
		await waitFor(() => expect(seenSearch).toContain("record_status=completed"));
		await waitFor(() => expect(seenSearch).not.toContain("record_offset"));
	});

	it("记录页签从 URL 恢复状态筛选（刷新保持）", async () => {
		renderPage("/admin/classes/7?tab=records&record_status=completed&record_offset=20");
		await waitFor(() =>
			expect(mocks.getRecords).toHaveBeenCalledWith(
				expect.objectContaining({ status: "completed", offset: 20, limit: 20 }),
			),
		);
	});

	it("作业页签分页进 URL 且只在需要时出现", async () => {
		mocks.getAssignments.mockResolvedValue({
			data: {
				items: Array.from({ length: 20 }, (_, i) => ({
					id: `a-${i}`,
					title: `作业 ${i}`,
					case_name: "急性心梗",
					class_name: CLASS.name,
					teacher_name: "王老师",
					start_time: "2026-09-01T00:00:00Z",
					end_time: "2026-12-01T00:00:00Z",
					audience_mode: "class",
					student_count: 4,
					completed_count: 2,
					created_at: "2026-08-30T00:00:00Z",
					is_closed: false,
				})),
				total: 45,
			},
		});
		renderPage("/admin/classes/7?tab=assignments");
		const pageTwo = await screen.findByRole("button", { name: "2" });
		fireEvent.click(pageTwo);
		await waitFor(() => expect(seenSearch).toContain("assignment_offset="));
	});

	it("作业/记录加载失败显示错误与重试，不伪装成空态", async () => {
		mocks.getAssignments.mockRejectedValue(new Error("offline"));
		renderPage("/admin/classes/7?tab=assignments");
		expect(await screen.findByText("作业列表加载失败")).toBeVisible();
		expect(screen.queryByText("本班暂无作业")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() => expect(mocks.getAssignments).toHaveBeenCalledTimes(2));
	});

	it("班级不存在（404）给明确空态，而不是加载失败", async () => {
		mocks.getClass.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
		renderPage("/admin/classes/7");
		expect(await screen.findByText("班级不存在")).toBeVisible();
	});

	it("班级参数非法时不发请求", async () => {
		renderPage("/admin/classes/abc");
		expect(await screen.findByText("班级参数不合法")).toBeVisible();
		expect(mocks.getClass).not.toHaveBeenCalled();
	});

	it("切页签后地址栏保留页签参数（可复制分享）", async () => {
		renderPage("/admin/classes/7");
		fireEvent.click(await screen.findByRole("tab", { name: /训练记录/ }));
		await waitFor(() => expect(seenSearch).toContain("tab=records"));
		// 保持默认页签不写 tab：只有切走才写
		fireEvent.click(screen.getByRole("tab", { name: /概览/ }));
		await waitFor(() => expect(seenSearch).not.toContain("tab="));
	});
});
