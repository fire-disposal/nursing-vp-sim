import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UsersTab from "@/components/admin/UsersTab";
import useAuthStore from "@/stores/authStore";
import { useSchoolScopeStore } from "@/stores/schoolScopeStore";

const mocks = vi.hoisted(() => ({
	getUsers: vi.fn(),
	getRoles: vi.fn(),
	getClasses: vi.fn(),
	getSchools: vi.fn(),
	register: vi.fn(),
	updateUser: vi.fn(),
	deleteUser: vi.fn(),
}));

vi.mock("@/api/admin/users", () => ({
	getUsers: mocks.getUsers,
	updateUser: mocks.updateUser,
	batchCreateUsers: vi.fn(),
	deleteUser: mocks.deleteUser,
	bulkAssignClass: vi.fn(),
	getStudentDetail: vi.fn(),
}));

vi.mock("@/api/admin/roles", () => ({
	getRoles: mocks.getRoles,
}));

vi.mock("@/api/admin/schools", () => ({
	getSchools: mocks.getSchools,
	createSchool: vi.fn(),
	updateSchool: vi.fn(),
	deleteSchool: vi.fn(),
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
	register: mocks.register,
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

describe("UsersTab 班级归属编辑", () => {
	// 回归：选项曾以平铺 `{ value, label, group }` 传给 Mantine Select，
	// 被 `getParsedComboboxData` 当成分组容器读 `items.map` → 整页 ErrorBoundary。
	it("「添加班级」后能选出按届别分组的班级，不炸整页", async () => {
		renderTab();
		await userEvent.click(await screen.findByRole("button", { name: "编辑 小明" }));
		await userEvent.click(await screen.findByRole("button", { name: "添加班级" }));

		const combo = await screen.findByRole("combobox", { name: "第 1 个班级" });
		await userEvent.click(combo);
		const listbox = document.getElementById(combo.getAttribute("aria-controls") ?? "");

		expect(within(listbox as HTMLElement).getByText("2024级")).toBeTruthy();
		expect(within(listbox as HTMLElement).getByRole("option", { name: "护理1班", hidden: true })).toBeTruthy();
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

const SCHOOLS = [
	{ id: 7, name: "杭州师范大学", class_count: 2, user_count: 3, created_at: "2026-01-01T00:00:00Z" },
	{ id: 8, name: "另一院校", class_count: 0, user_count: 0, created_at: "2026-01-01T00:00:00Z" },
];

/**
 * 院校归属（用户口中的「单位」）：编辑用户时能看到并改；平台角色建号必须选。
 * 现场（2026-10-27）：表单里没有这一项 → 归属错了既改不了，新建账号也只能
 * 靠「顺手加个班级」间接推导，属于核心业务断链。
 */
describe("UsersTab 院校归属", () => {
	beforeEach(() => {
		useAuthStore.setState({ permissions: ["school_manage"] });
		mocks.getSchools.mockResolvedValue({ data: SCHOOLS });
	});

	afterEach(() => {
		useAuthStore.setState({ permissions: [] });
	});

	async function pickSchool(name: string) {
		const combo = await screen.findByRole("combobox", { name: "院校" });
		await userEvent.click(combo);
		const listbox = document.getElementById(combo.getAttribute("aria-controls") ?? "");
		await userEvent.click(
			within(listbox as HTMLElement).getByRole("option", { name, hidden: true }),
		);
	}

	it("编辑用户时改院校，保存请求带上 school_id", async () => {
		mocks.updateUser.mockResolvedValue({ data: MULTI_CLASS_USER });
		renderTab();
		await userEvent.click(await screen.findByRole("button", { name: "编辑 小明" }));

		await pickSchool("另一院校");
		await userEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() =>
			expect(mocks.updateUser).toHaveBeenCalledWith(
				42,
				expect.objectContaining({ school_id: 8 }),
			),
		);
	});

	it("平台角色建号必须选院校：未选先拦住，选了再随注册请求提交", async () => {
		mocks.register.mockResolvedValue({
			data: { id: 99, username: "newbie", role: "student", display_name: "新人", student_id: null },
		});
		renderTab();
		await userEvent.click(await screen.findByRole("button", { name: "注册新用户" }));

		await userEvent.type(screen.getByLabelText(/用户名/), "newbie");
		await userEvent.type(screen.getByLabelText(/密码/), "secret123");
		await userEvent.type(screen.getByLabelText(/姓名/), "新人");
		await userEvent.click(screen.getByRole("button", { name: "注册" }));

		expect(await screen.findByText("请选择所属院校")).toBeTruthy();
		expect(mocks.register).not.toHaveBeenCalled();

		await pickSchool("杭州师范大学");
		await userEvent.click(screen.getByRole("button", { name: "注册" }));

		await waitFor(() =>
			expect(mocks.register).toHaveBeenCalledWith(
				expect.objectContaining({ school_id: 7 }),
			),
		);
	});
});

/**
 * 「当前院校」作用域：平台角色把工作视图收窄到某一所后，
 * 逐列表的院校筛选不再重复出现，新建账号的院校默认跟随作用域。
 */
describe("UsersTab 当前院校作用域", () => {
	beforeEach(() => {
		useAuthStore.setState({ permissions: ["school_manage"] });
		mocks.getSchools.mockResolvedValue({ data: SCHOOLS });
		useSchoolScopeStore.getState().setSchool({
			id: 7,
			name: "杭州师范大学",
			themeColor: null,
			hasLogo: false,
			logoUpdatedAt: null,
		});
	});

	afterEach(() => {
		useAuthStore.setState({ permissions: [] });
		useSchoolScopeStore.getState().setSchool(null);
	});

	it("收窄到某校：不再显示院校筛选，新建账号默认落在该校", async () => {
		mocks.register.mockResolvedValue({
			data: { id: 99, username: "newbie", role: "student", display_name: "新人", student_id: null },
		});
		renderTab();
		await screen.findByText("小明");

		expect(screen.queryByRole("combobox", { name: "院校筛选" })).toBeNull();

		await userEvent.click(screen.getByRole("button", { name: "注册新用户" }));
		await userEvent.type(screen.getByLabelText(/用户名/), "newbie");
		await userEvent.type(screen.getByLabelText(/密码/), "secret123");
		await userEvent.type(screen.getByLabelText(/姓名/), "新人");
		await userEvent.click(screen.getByRole("button", { name: "注册" }));

		await waitFor(() =>
			expect(mocks.register).toHaveBeenCalledWith(
				expect.objectContaining({ school_id: 7 }),
			),
		);
	});
});
