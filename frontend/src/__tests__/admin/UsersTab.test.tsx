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
