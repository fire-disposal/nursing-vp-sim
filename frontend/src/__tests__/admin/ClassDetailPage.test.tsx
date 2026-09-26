import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassDetailPage from "@/pages/admin/ClassDetailPage";

const mocks = vi.hoisted(() => ({
	getClass: vi.fn(),
	getClassMembers: vi.fn(),
	getClassSummary: vi.fn(),
	removeClassMember: vi.fn(),
	removeClassMembers: vi.fn(),
	addClassMembers: vi.fn(),
	getUsers: vi.fn(),
}));

vi.mock("@/api/classes", () => ({
	getClass: mocks.getClass,
	getClassMembers: mocks.getClassMembers,
	getClassSummary: mocks.getClassSummary,
	removeClassMember: mocks.removeClassMember,
	removeClassMembers: mocks.removeClassMembers,
	addClassMembers: mocks.addClassMembers,
	getClasses: vi.fn(),
	createClass: vi.fn(),
	updateClass: vi.fn(),
	deleteClass: vi.fn(),
}));

vi.mock("@/api/admin/users", () => ({
	getUsers: mocks.getUsers,
	getStats: vi.fn(),
	updateUser: vi.fn(),
	batchCreateUsers: vi.fn(),
	deleteUser: vi.fn(),
	bulkAssignClass: vi.fn(),
	getStudentDetail: vi.fn(),
}));

function member(userId: number, role: "student" | "teacher", name: string) {
	return {
		user_id: userId,
		username: `u${userId}`,
		display_name: name,
		student_id: `S${userId}`,
		member_role: role,
		joined_at: "2026-03-01T00:00:00Z",
	};
}

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/admin/classes/1"]}>
				<Routes>
					<Route path="/admin/classes/:classId" element={<ClassDetailPage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getClass.mockResolvedValue({
		data: {
			id: 1,
			name: "护理1班",
			cohort_label: "2024级",
			student_count: 2,
			teacher_count: 1,
			assignment_count: 4,
			created_at: "2026-01-01T00:00:00Z",
			members: [],
		},
	});
	mocks.getClassSummary.mockResolvedValue({ data: [] });
	mocks.removeClassMember.mockResolvedValue({ data: { message: "ok" } });
	mocks.removeClassMembers.mockResolvedValue({
		data: { added: 0, updated: 0, removed: 1, skipped: 0, errors: [] },
	});
	mocks.getUsers.mockResolvedValue({ data: { items: [], total: 0, offset: 0, limit: 20 } });
	mocks.getClassMembers.mockImplementation(
		(_classId: number, params: Record<string, unknown>) =>
			Promise.resolve({
				data: {
					items:
						params.role === "teacher"
							? [member(9, "teacher", "王老师")]
							: [member(1, "student", "小明"), member(2, "student", "小红")],
					total: params.role === "teacher" ? 1 : 2,
					offset: 0,
					limit: 20,
				},
			}),
	);
});

describe("ClassDetailPage 花名册", () => {
	it("展示届别、成员计数与学生花名册", async () => {
		renderPage();

		await waitFor(() => expect(mocks.getClass).toHaveBeenCalledWith(1));
		expect(await screen.findByText("届别：2024级")).toBeInTheDocument();
		expect(await screen.findByText("小明")).toBeInTheDocument();
		expect(screen.getByText("小红")).toBeInTheDocument();
		expect(mocks.getClassMembers).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ role: "student", limit: 20 }),
		);
	});

	it("切到教师 Tab 时按 teacher 角色重新拉取成员", async () => {
		renderPage();
		await screen.findByText("小明");

		await userEvent.click(screen.getByText("教师（1）"));

		await waitFor(() =>
			expect(mocks.getClassMembers).toHaveBeenCalledWith(
				1,
				expect.objectContaining({ role: "teacher" }),
			),
		);
		expect(await screen.findByText("王老师")).toBeInTheDocument();
	});

	it("搜索成员时把关键词传给服务端", async () => {
		renderPage();
		await screen.findByText("小明");

		await userEvent.type(
			screen.getByPlaceholderText("搜索姓名、用户名或学号..."),
			"小红",
		);

		await waitFor(() =>
			expect(mocks.getClassMembers).toHaveBeenCalledWith(
				1,
				expect.objectContaining({ search: "小红" }),
			),
		);
	});

	it("移出成员需二次确认并调用成员移除接口", async () => {
		renderPage();
		await screen.findByText("小明");

		await userEvent.click(screen.getAllByText("移出")[0]);
		expect(mocks.removeClassMember).not.toHaveBeenCalled();

		await userEvent.click(await screen.findByText("确定移出"));
		await waitFor(() => expect(mocks.removeClassMember).toHaveBeenCalledWith(1, 1));
	});

	it("展开「其他班级」时按用户名回查完整归属", async () => {
		renderPage();
		await screen.findByText("小明");

		await userEvent.click(screen.getAllByText("其他班级")[0]);

		await waitFor(() =>
			expect(mocks.getUsers).toHaveBeenCalledWith(
				expect.objectContaining({ search: "u1" }),
			),
		);
	});
});
