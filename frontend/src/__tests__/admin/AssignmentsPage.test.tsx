import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssignmentsPage from "@/pages/admin/AssignmentsPage";

const mocks = vi.hoisted(() => ({
	getAssignments: vi.fn(),
	createAssignment: vi.fn(),
	getAssignment: vi.fn(),
	updateAssignment: vi.fn(),
	deleteAssignment: vi.fn(),
	getManageCases: vi.fn(),
	getClasses: vi.fn(),
	getClassMembers: vi.fn(),
}));

vi.mock("@/api/assignments", () => ({
	getAssignments: mocks.getAssignments,
	createAssignment: mocks.createAssignment,
	getAssignment: mocks.getAssignment,
	updateAssignment: mocks.updateAssignment,
	deleteAssignment: mocks.deleteAssignment,
	exportAssignment: vi.fn(),
	getStudentAssignments: vi.fn(),
	startAssignment: vi.fn(),
}));

vi.mock("@/api/cases", () => ({
	getManageCases: mocks.getManageCases,
	getCases: vi.fn(),
	createCase: vi.fn(),
	updateCase: vi.fn(),
	deleteCase: vi.fn(),
}));

vi.mock("@/api/classes", () => ({
	getClasses: mocks.getClasses,
	getClassMembers: mocks.getClassMembers,
	getClass: vi.fn(),
	createClass: vi.fn(),
	updateClass: vi.fn(),
	deleteClass: vi.fn(),
	addClassMembers: vi.fn(),
	removeClassMembers: vi.fn(),
	removeClassMember: vi.fn(),
	getClassSummary: vi.fn(),
}));

const ASSIGNMENT_LIST_ITEM = {
	id: "asg-1",
	title: "第一次作业",
	case_name: "慢阻肺急性加重",
	class_name: "护理1班",
	teacher_name: "王老师",
	start_time: "2026-08-01T02:00:00Z",
	end_time: "2026-08-10T02:00:00Z",
	audience_mode: "class",
	student_count: 3,
	completed_count: 1,
	created_at: "2026-07-30T00:00:00Z",
	is_closed: false,
	max_attempts: 1,
};

const CLASS = {
	id: 5,
	name: "护理1班",
	cohort_label: "2024级",
	student_count: 3,
	teacher_count: 1,
	assignment_count: 1,
	created_at: "2026-01-01T00:00:00Z",
};

/** 打开病例选择器后回车选中第一个病例（列表与表格中病例名重复，避免按文本点击）。 */
async function pickFirstCase() {
	await userEvent.click(screen.getByText("选择病例..."));
	const box = await screen.findByPlaceholderText("输入关键词搜索病例...");
	await waitFor(() => expect(box).toHaveFocus());
	await userEvent.keyboard("{Enter}");
}

/** 通过 `aria-controls` 定位下拉列表，避免选中同名选项的其他下拉。 */
async function findOption(name: string, inputPlaceholder: string) {
	const input = screen.getByPlaceholderText(inputPlaceholder);
	const listbox = document.getElementById(input.getAttribute("aria-controls") ?? "");
	return within(listbox as HTMLElement).getByRole("option", { name, hidden: true });
}

/**
 * 选择弹窗里的班级：页面筛选栏与弹窗中会出现同名选项，
 * 因此按弹窗输入框的 aria-controls 精确定位其下拉。
 */
async function pickClassOption(name: string) {
	await userEvent.click(screen.getByPlaceholderText("选择班级…"));
	await userEvent.click(await findOption(name, "选择班级…"));
}

function renderPage() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/admin/assignments"]}>
				<AssignmentsPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** 已发布病例（可用于作业）。 */
const CASE_ITEM = {
	id: 11,
	name: "慢阻肺急性加重",
	description: "老年男性，咳嗽咳痰加重 3 天",
	status: "published",
	current_revision_id: 31,
	current_revision_no: 1,
	patient_name: "王大爷",
	patient_age: 68,
	patient_gender: "男",
	chief_complaint: "咳嗽咳痰加重 3 天",
	time_limit: 30,
	difficulty: 2,
	patient_personality: "焦虑",
	capabilities: { physical_exam: true, quiz: true },
	is_open: true,
	created_at: "2026-01-01T00:00:00Z",
	training_count: 2,
};

/** 草稿病例：不能用于作业。 */
const DRAFT_CASE_ITEM = { ...CASE_ITEM, id: 12, name: "草稿：未完成的病例", status: "draft", training_count: 0 };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getAssignments.mockResolvedValue({
		data: { items: [ASSIGNMENT_LIST_ITEM], total: 1, offset: 0, limit: 100 },
	});
	mocks.getManageCases.mockImplementation((params?: { status?: string }) => {
		if (params?.status === "archived") {
			return Promise.resolve({ data: { items: [], total: 0, offset: 0, limit: 1 } });
		}
		return Promise.resolve({
			data: { items: [CASE_ITEM, DRAFT_CASE_ITEM], total: 2, offset: 0, limit: 200 },
		});
	});
	mocks.getClasses.mockResolvedValue({ data: [CLASS] });
	mocks.getClassMembers.mockResolvedValue({
		data: {
			items: [
				{
					user_id: 7,
					username: "s7",
					display_name: "小明",
					student_id: "S7",
					member_role: "student",
					joined_at: "2026-02-01T00:00:00Z",
				},
				{
					user_id: 8,
					username: "s8",
					display_name: "小红",
					student_id: "S8",
					member_role: "student",
					joined_at: "2026-02-02T00:00:00Z",
				},
			],
			total: 2,
			offset: 0,
			limit: 200,
		},
	});
	mocks.createAssignment.mockResolvedValue({ data: {} });
	mocks.updateAssignment.mockResolvedValue({ data: {} });
});

/**
 * DateTimePicker 用测试替身：本文件验证的是「受众模式 → 提交载荷」的业务逻辑，
 * 日历弹层交互属于库行为（真实控件是 button + 隐藏 input，jsdom 下时序不稳）。
 * 替身把 value/onChange 原样透传，保持与 valueFormat="YYYY-MM-DD[T]HH:mm" 相同的字符串契约。
 */
vi.mock("@mantine/dates", () => ({
	DateTimePicker: ({ label, ...props }: { label?: string } & Record<string, unknown>) => (
		<label>
			{label}
			<input aria-label={typeof label === "string" ? label : undefined} {...props} />
		</label>
	),
}));

describe("AssignmentsPage 受众", () => {
	it("列表展示受众口径与人数", async () => {
		renderPage();

		await screen.findAllByText("第一次作业");
		expect(screen.getAllByText("全班 3 人").length).toBeGreaterThan(0);
	});

	it("病例选择器只列已发布病例，草稿/归档给出可读提示", async () => {
		mocks.getManageCases.mockImplementation((params?: { status?: string }) => {
			if (params?.status === "archived") {
				return Promise.resolve({ data: { items: [], total: 2, offset: 0, limit: 1 } });
			}
			return Promise.resolve({
				data: { items: [CASE_ITEM, DRAFT_CASE_ITEM], total: 2, offset: 0, limit: 200 },
			});
		});
		renderPage();
		await screen.findAllByText("第一次作业");

		await userEvent.click(screen.getByText("创建作业"));
		// 提示：草稿 / 已归档病例不可选
		expect(
			await screen.findByText(/另有 1 个草稿病例、2 个已归档病例不可选/),
		).toBeInTheDocument();

		// 下拉里只出现已发布病例：搜索草稿病例名 → 无匹配
		await userEvent.click(screen.getByText("选择病例..."));
		const box = await screen.findByPlaceholderText("输入关键词搜索病例...");
		await waitFor(() => expect(box).toHaveFocus());
		await userEvent.type(box, "草稿");
		expect(screen.getByText("无匹配病例")).toBeInTheDocument();
		expect(screen.queryByText(DRAFT_CASE_ITEM.name)).toBeNull();
	});

	it("指定学生发布：预览人数随勾选更新，提交携带 audience.mode=selected", async () => {
		renderPage();
		await screen.findAllByText("第一次作业");

		await userEvent.click(screen.getByText("创建作业"));
		await userEvent.type(screen.getByPlaceholderText("作业标题"), "呼吸评估练习");

		await pickFirstCase();

		// 班级
		await pickClassOption("2024级 护理1班");

		// 受众：全班 → 指定学生
		expect(
			await screen.findByText("将发布给 3 名学生：2024级 护理1班 全班 3 人"),
		).toBeInTheDocument();
		await userEvent.click(screen.getByRole("radio", { name: "指定学生" }));

		await waitFor(() =>
			expect(
				screen.getByText("将发布给 0 名学生：2024级 护理1班 指定 0 人"),
			).toBeInTheDocument(),
		);
		await userEvent.click(await screen.findByLabelText("选择 小明"));
		await waitFor(() =>
			expect(
				screen.getByText("将发布给 1 名学生：2024级 护理1班 指定 1 人"),
			).toBeInTheDocument(),
		);

		await userEvent.type(screen.getByLabelText(/开始时间/), "2026-08-01T10:00");
		await userEvent.type(screen.getByLabelText(/截止时间/), "2026-08-09T10:00");
		await userEvent.click(screen.getByText("发布"));

		await waitFor(() => expect(mocks.createAssignment).toHaveBeenCalled());
		expect(mocks.createAssignment.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				title: "呼吸评估练习",
				case_id: 11,
				class_id: 5,
				audience: { mode: "selected", user_ids: [7] },
			}),
		);
	});

	it("全班发布时不带 user_ids", async () => {
		renderPage();
		await screen.findAllByText("第一次作业");

		await userEvent.click(screen.getByText("创建作业"));
		await userEvent.type(screen.getByPlaceholderText("作业标题"), "全班练习");
		await pickFirstCase();
		await pickClassOption("2024级 护理1班");
		await userEvent.type(screen.getByLabelText(/开始时间/), "2026-08-01T10:00");
		await userEvent.type(screen.getByLabelText(/截止时间/), "2026-08-09T10:00");
		await userEvent.click(screen.getByText("发布"));

		await waitFor(() => expect(mocks.createAssignment).toHaveBeenCalled());
		expect(mocks.createAssignment.mock.calls[0][0].audience).toEqual({ mode: "class" });
	});

	it("已有训练记录时锁定病例/班级/受众，保存不回传这些字段", async () => {
		mocks.getAssignment.mockResolvedValue({
			data: {
				id: "asg-1",
				title: "第一次作业",
				description: null,
				case_id: 11,
				case_name: "慢阻肺急性加重",
				class_id: 5,
				class_name: "护理1班",
				features: {},
				behavior: { mode: "guided" },
				audience_mode: "class",
				recipient_ids: [7, 8, 9],
				start_time: "2026-08-01T02:00:00Z",
				end_time: "2026-08-10T02:00:00Z",
				created_at: "2026-07-30T00:00:00Z",
				updated_at: "2026-07-30T00:00:00Z",
				student_count: 3,
				completed_count: 2,
				scored_count: 1,
				avg_score: 80,
				max_score: 90,
				min_score: 70,
				completion_rate: 0.66,
				students: [],
				max_attempts: 1,
			},
		});
		renderPage();
		await screen.findAllByText("第一次作业");

		await userEvent.click(screen.getAllByTitle("编辑")[0]);

		expect(
			await screen.findByText(/已有学生开始练习：病例、班级与已发布受众已固化/),
		).toBeInTheDocument();
		expect(
			screen.getByText(/已发布给 3 名学生（全班快照/),
		).toBeInTheDocument();

		await userEvent.click(screen.getByText("保存"));

		await waitFor(() => expect(mocks.updateAssignment).toHaveBeenCalled());
		const [, patch] = mocks.updateAssignment.mock.calls[0];
		expect(patch).not.toHaveProperty("audience");
		expect(patch).not.toHaveProperty("case_id");
		expect(patch).not.toHaveProperty("class_id");
	});
});
