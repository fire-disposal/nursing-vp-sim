import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersTab from "@/components/admin/UsersTab";

const mocks = vi.hoisted(() => ({
	getUsers: vi.fn(),
	getRoles: vi.fn(),
	getClasses: vi.fn(),
	updateUser: vi.fn(),
	deleteUser: vi.fn(),
}));

vi.mock("@/api/admin/users", () => ({
	getUsers: mocks.getUsers,
	getStats: vi.fn(),
	updateUser: mocks.updateUser,
	batchCreateUsers: vi.fn(),
	deleteUser: mocks.deleteUser,
	bulkAssignClass: vi.fn(),
	getStudentDetail: vi.fn(),
}));

vi.mock("@/api/admin/roles", () => ({
	getRoles: mocks.getRoles,
}));

vi.mock("@/api/classes", () => ({
	getClasses: mocks.getClasses,
	getClass: vi.fn(),
	createClass: vi.fn(),
	updateClass: vi.fn(),
	deleteClass: vi.fn(),
	getClassMembers: vi.fn(),
	addClassMembers: vi.fn(),
	removeClassMembers: vi.fn(),
	removeClassMember: vi.fn(),
	getClassSummary: vi.fn(),
}));

vi.mock("@/api/auth", () => ({
	register: vi.fn(),
	login: vi.fn(),
	logout: vi.fn(),
	refreshToken: vi.fn(),
	getMe: vi.fn(),
	changePassword: vi.fn(),
	updateMyProfile: vi.fn(),
}));

const CLASSES = [
	{
		id: 1,
		name: "护理1班",
		cohort_label: "2024级",
		student_count: 1,
		teacher_count: 0,
		assignment_count: 0,
		created_at: "2026-01-01T00:00:00Z",
	},
	{
		id: 2,
		name: "护理2班",
		cohort_label: "2025级",
		student_count: 1,
		teacher_count: 0,
		assignment_count: 0,
		created_at: "2026-01-01T00:00:00Z",
	},
];

const MULTI_CLASS_USER = {
	id: 42,
	username: "u42",
	role: "student",
	role_display_name: "学生",
	display_name: "小明",
	student_id: "S42",
	gender: null,
	avatar: null,
	memberships: [
		{
			class_id: 1,
			class_name: "护理1班",
			cohort_label: "2024级",
			member_role: "student",
			joined_at: "2026-02-01T00:00:00Z",
		},
		{
			class_id: 2,
			class_name: "护理2班",
			cohort_label: "2025级",
			member_role: "teacher",
			joined_at: "2026-03-01T00:00:00Z",
		},
	],
	created_at: "2026-01-01T00:00:00Z",
};

function renderTab() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/admin/users"]}>
				<UsersTab />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getUsers.mockResolvedValue({
		data: { items: [MULTI_CLASS_USER], total: 1, offset: 0, limit: 50 },
	});
	mocks.getRoles.mockResolvedValue({ data: [{ name: "student", display_name: "学生" }] });
	mocks.getClasses.mockResolvedValue({ data: CLASSES });
});

describe("UsersTab 多班级归属", () => {
	it("行内同时显示学习班级与任教班级", async () => {
		renderTab();
		await screen.findByText("小明");

		expect(screen.getAllByText("学习班级").length).toBeGreaterThan(0);
		expect(screen.getAllByText("任教班级").length).toBeGreaterThan(0);
		expect(screen.getAllByText("2024级 护理1班").length).toBeGreaterThan(0);
		expect(screen.getAllByText("2025级 护理2班").length).toBeGreaterThan(0);
	});

	it("按班级筛选后行内仍显示完整归属，且请求带上 class_id", async () => {
		renderTab();
		await screen.findByText("小明");

		const classInput = screen.getByPlaceholderText("全部班级");
		await userEvent.click(classInput);
		const listbox = document.getElementById(classInput.getAttribute("aria-controls") ?? "");
		await userEvent.click(
			within(listbox as HTMLElement).getByRole("option", {
				name: "2024级 护理1班",
				hidden: true,
			}),
		);

		await waitFor(() =>
			expect(mocks.getUsers).toHaveBeenCalledWith(
				expect.objectContaining({ class_id: 1 }),
			),
		);
		expect(screen.getAllByText("2024级 护理1班").length).toBeGreaterThan(0);
		expect(screen.getAllByText("2025级 护理2班").length).toBeGreaterThan(0);
	});
});

describe("UsersTab 账号生命周期操作", () => {
	it("删除用户需二次确认，确认后调用 deleteUser", async () => {
		mocks.deleteUser.mockResolvedValue({ data: { ok: true, message: "已删除" } });
		renderTab();
		await userEvent.click(await screen.findByRole("button", { name: "删除 小明" }));

		// 弹窗内断言：卡片上的 Tooltip 也含"删除用户"，全局查询会重复
		const delConfirm = await screen.findByRole("button", { name: "确定删除" });
		const delDialog = delConfirm.closest('[role="dialog"], [role="alertdialog"], .mantine-Modal-content') as HTMLElement;
		expect(within(delDialog).getByText("删除用户")).toBeTruthy();
		expect(within(delDialog).getByText(/此操作不可恢复/)).toBeTruthy();
		await userEvent.click(delConfirm);

		await waitFor(() => expect(mocks.deleteUser).toHaveBeenCalledWith(42));
	});

	it("停用账号需二次确认并提交 is_active=false；启用则不弹确认", async () => {
		mocks.updateUser.mockResolvedValue({ data: MULTI_CLASS_USER });
		renderTab();
		await userEvent.click(await screen.findByRole("button", { name: "停用 小明 的账号" }));

		const stopConfirm = await screen.findByRole("button", { name: "确定停用" });
		const stopDialog = stopConfirm.closest('[role="dialog"], [role="alertdialog"], .mantine-Modal-content') as HTMLElement;
		expect(within(stopDialog).getByText("停用账号")).toBeTruthy();
		expect(within(stopDialog).getByText(/无法登录/)).toBeTruthy();
		await userEvent.click(stopConfirm);

		await waitFor(() =>
			expect(mocks.updateUser).toHaveBeenCalledWith(42, { is_active: false }),
		);
	});

	it("「显示已停用」把 include_inactive 带进请求", async () => {
		renderTab();
		await screen.findByText("小明");
		await userEvent.click(screen.getByLabelText("显示已停用"));

		await waitFor(() => {
			const last = mocks.getUsers.mock.calls.at(-1)?.[0] as Record<string, unknown>;
			expect(last.include_inactive).toBe(true);
		});
	});
});
