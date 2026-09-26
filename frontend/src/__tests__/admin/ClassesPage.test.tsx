import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassesPage from "@/pages/admin/ClassesPage";

const mocks = vi.hoisted(() => ({
	getClasses: vi.fn(),
	createClass: vi.fn(),
	updateClass: vi.fn(),
	deleteClass: vi.fn(),
}));

vi.mock("@/api/classes", () => ({
	getClasses: mocks.getClasses,
	createClass: mocks.createClass,
	updateClass: mocks.updateClass,
	deleteClass: mocks.deleteClass,
	getClass: vi.fn(),
	getClassMembers: vi.fn(),
	addClassMembers: vi.fn(),
	removeClassMembers: vi.fn(),
	removeClassMember: vi.fn(),
	getClassSummary: vi.fn(),
}));

const CLASSES = [
	{
		id: 1,
		name: "护理1班",
		cohort_label: "2024级",
		student_count: 30,
		teacher_count: 2,
		assignment_count: 3,
		created_at: "2026-01-01T00:00:00Z",
	},
	{
		id: 2,
		name: "护理1班",
		cohort_label: "2025级",
		student_count: 12,
		teacher_count: 1,
		assignment_count: 0,
		created_at: "2026-02-01T00:00:00Z",
	},
];

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/admin/classes"]}>
				<ClassesPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getClasses.mockResolvedValue({ data: CLASSES });
	mocks.createClass.mockResolvedValue({ data: CLASSES[0] });
	mocks.updateClass.mockResolvedValue({ data: CLASSES[0] });
	mocks.deleteClass.mockResolvedValue({ data: { message: "ok" } });
});

describe("ClassesPage", () => {
	it("按届别展示班级及成员计数", async () => {
		renderPage();

		await waitFor(() => expect(mocks.getClasses).toHaveBeenCalledWith({}));
		await screen.findAllByText("护理1班");
		expect(screen.getAllByText("护理1班").length).toBeGreaterThanOrEqual(2);
		expect(screen.getAllByText("2024级").length).toBeGreaterThan(0);
		expect(screen.getAllByText("2025级").length).toBeGreaterThan(0);
		expect(screen.getAllByText(/30 名学生 · 2 名教师/).length).toBeGreaterThan(0);
	});

	it("按届别筛选时请求携带 cohort_label", async () => {
		renderPage();
		await screen.findAllByText("护理1班");

		const cohortInput = screen.getByPlaceholderText("全部届别");
		await userEvent.click(cohortInput);
		const listbox = document.getElementById(cohortInput.getAttribute("aria-controls") ?? "");
		await userEvent.click(
			within(listbox as HTMLElement).getByRole("option", { name: "2025级", hidden: true }),
		);

		await waitFor(() =>
			expect(mocks.getClasses).toHaveBeenCalledWith({ cohort_label: "2025级" }),
		);
	});

	it("新建班级时提交名称与届别", async () => {
		renderPage();
		await screen.findAllByText("护理1班");

		await userEvent.click(screen.getByText("新建班级"));
		await userEvent.type(
			await screen.findByPlaceholderText("如: 2024级"),
			"2025级",
		);
		await userEvent.type(screen.getByPlaceholderText("如: 护理1班"), "护理3班");
		await userEvent.click(screen.getByText("创建"));

		await waitFor(() =>
			expect(mocks.createClass).toHaveBeenCalledWith({
				name: "护理3班",
				cohort_label: "2025级",
			}),
		);
	});

	it("删除班级需二次确认后才请求后端", async () => {
		renderPage();
		await screen.findAllByText("护理1班");

		await userEvent.click(screen.getAllByText("删除")[0]);
		expect(mocks.deleteClass).not.toHaveBeenCalled();

		await userEvent.click(await screen.findByText("确定删除"));
		await waitFor(() => expect(mocks.deleteClass).toHaveBeenCalledWith(1));
	});
});
