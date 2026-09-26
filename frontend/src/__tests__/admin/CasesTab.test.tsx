import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CasesTab from "@/components/admin/CasesTab";
import type * as ApiModule from "@/api";
import type { components } from "@/api/api-types.gen";

type CaseManageItem = components["schemas"]["CaseManageItem"];
type CaseValidationReport = components["schemas"]["CaseValidationReport"];

const mocks = vi.hoisted(() => ({
	getManageCases: vi.fn(),
	getCaseValidation: vi.fn(),
	publishCase: vi.fn(),
	archiveCase: vi.fn(),
	toggleCaseOpen: vi.fn(),
	deleteCase: vi.fn(),
	getCaseDetail: vi.fn(),
	getCaseRevisions: vi.fn(),
	createCase: vi.fn(),
	updateCase: vi.fn(),
	generateCase: vi.fn(),
	toast: {
		success: vi.fn(),
		error: vi.fn(),
		apiError: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	},
	confirm: vi.fn(() => true),
}));

vi.mock("@/api", async (importOriginal) => {
	const actual = await importOriginal<typeof ApiModule>();
	return {
		...actual,
		getManageCases: mocks.getManageCases,
		getCaseValidation: mocks.getCaseValidation,
		publishCase: mocks.publishCase,
		archiveCase: mocks.archiveCase,
		toggleCaseOpen: mocks.toggleCaseOpen,
		deleteCase: mocks.deleteCase,
		getCaseDetail: mocks.getCaseDetail,
		getCaseRevisions: mocks.getCaseRevisions,
		createCase: mocks.createCase,
		updateCase: mocks.updateCase,
		generateCase: mocks.generateCase,
	};
});

vi.mock("@/components/Toast", () => ({
	useToast: () => mocks.toast,
}));

vi.mock("@/components/ui/confirm", () => ({
	useConfirm: () => ({ confirm: mocks.confirm }),
}));

function caseItem(overrides: Partial<CaseManageItem> & { id: number; name: string }): CaseManageItem {
	return {
		status: "draft",
		current_revision_id: null,
		current_revision_no: null,
		patient_name: "王大爷",
		patient_age: 68,
		patient_gender: "男",
		chief_complaint: "咳嗽咳痰",
		time_limit: 30,
		difficulty: 2,
		patient_personality: "焦虑",
		capabilities: { physical_exam: true },
		is_open: false,
		created_at: "2026-01-01T00:00:00Z",
		training_count: 0,
		...overrides,
	};
}

const DRAFT = caseItem({ id: 12, name: "草稿病例", status: "draft" });
const PUBLISHED = caseItem({
	id: 11,
	name: "已发布病例",
	status: "published",
	current_revision_id: 21,
	current_revision_no: 2,
	is_open: true,
});
const ARCHIVED = caseItem({ id: 13, name: "归档病例", status: "archived", current_revision_no: 1 });

function report(overrides: Partial<CaseValidationReport> = {}): CaseValidationReport {
	return {
		case_id: DRAFT.id,
		case_name: DRAFT.name,
		publishable: true,
		errors: [],
		warnings: [],
		infos: [],
		...overrides,
	};
}

function renderTab() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<CasesTab />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.confirm.mockResolvedValue(true);
	mocks.getManageCases.mockResolvedValue({
		data: { items: [DRAFT, PUBLISHED], total: 2, offset: 0, limit: 50 },
	});
	mocks.getCaseValidation.mockResolvedValue({ data: report() });
	mocks.publishCase.mockResolvedValue({
		data: {
			case: { ...DRAFT, status: "published", current_revision_no: 1 },
			report: report({ publishable: true }),
		},
	});
	mocks.archiveCase.mockResolvedValue({ data: { ...PUBLISHED, status: "archived" } });
	mocks.toggleCaseOpen.mockResolvedValue({ data: PUBLISHED });
});

describe("CasesTab 生命周期", () => {
	it("列表展示状态徽章与当前版本，且不再有类型列", async () => {
		renderTab();

		expect(await screen.findByText("草稿病例")).toBeInTheDocument();
		const table = screen.getByRole("table");
		expect(within(table).getByText("草稿")).toBeInTheDocument();
		expect(within(table).getByText("已发布")).toBeInTheDocument();
		expect(within(table).getByText("v2")).toBeInTheDocument();
		expect(within(table).queryByText("类型")).toBeNull();
		expect(within(table).queryByText("病史采集")).toBeNull();
	});

	it("按状态筛选把 status 传给后端", async () => {
		renderTab();
		await screen.findByText("草稿病例");

		const statusSelect = screen.getByPlaceholderText("全部状态");
		await userEvent.click(statusSelect);
		const listbox = document.getElementById(statusSelect.getAttribute("aria-controls") ?? "");
		await userEvent.click(
			within(listbox as HTMLElement).getByRole("option", { name: "草稿", hidden: true }),
		);

		await waitFor(() =>
			expect(mocks.getManageCases).toHaveBeenCalledWith(
				expect.objectContaining({ status: "draft" }),
			),
		);
	});

	it("发布门禁有 error 时展示字段级报告并阻止发布", async () => {
		mocks.getCaseValidation.mockResolvedValue({
			data: report({
				publishable: false,
				errors: [
					{
						severity: "error",
						field: "hidden_info[0]",
						message: "隐藏信息泄漏到公开字段",
						fix_hint: "从 present_illness 中移除",
					},
				],
			}),
		});
		renderTab();
		const draftRow = (await screen.findByText("草稿病例")).closest("tr") as HTMLElement;

		await userEvent.click(within(draftRow).getByRole("button", { name: "发布" }));

		expect(await screen.findByText(/未通过发布门禁：1 个错误/)).toBeInTheDocument();
		expect(screen.getByText("hidden_info[0]")).toBeInTheDocument();
		expect(screen.getByText("隐藏信息泄漏到公开字段")).toBeInTheDocument();
		expect(screen.getByText(/从 present_illness 中移除/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "确认发布" })).toBeDisabled();
		expect(mocks.publishCase).not.toHaveBeenCalled();
	});

	it("门禁通过后确认发布，并提示发布后仍需开放", async () => {
		mocks.getCaseValidation.mockResolvedValue({
			data: report({
				publishable: true,
				warnings: [
					{ severity: "warning", field: "activities", message: "缺少活动声明", fix_hint: "" },
				],
			}),
		});
		mocks.publishCase.mockResolvedValue({
			data: {
				case: { ...DRAFT, status: "published", is_open: false, current_revision_no: 1 },
				report: report({
					publishable: true,
					warnings: [
						{ severity: "warning", field: "activities", message: "缺少活动声明", fix_hint: "" },
					],
				}),
			},
		});
		renderTab();
		const draftRow = (await screen.findByText("草稿病例")).closest("tr") as HTMLElement;

		await userEvent.click(within(draftRow).getByRole("button", { name: "发布" }));
		expect(await screen.findByText(/通过发布门禁，可以发布/)).toBeInTheDocument();
		expect(screen.getByText("缺少活动声明")).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "确认发布" }));

		await waitFor(() => expect(mocks.publishCase).toHaveBeenCalledWith(DRAFT.id));
		await waitFor(() =>
			expect(mocks.toast.success).toHaveBeenCalledWith(expect.stringContaining("已发布 v1")),
		);
		expect(mocks.toast.info).toHaveBeenCalledWith(expect.stringContaining("未向学生开放"));
	});

	it("发布时后端仍返回门禁报告（422）则在弹窗内展示", async () => {
		mocks.publishCase.mockRejectedValue({
			response: {
				data: {
					detail: {
						code: "CASE_NOT_PUBLISHABLE",
						message: "病例未通过发布门禁：1 个 error",
						report: report({
							publishable: false,
							errors: [
								{
									severity: "error",
									field: "chief_complaint",
									message: "主诉为空",
									fix_hint: "补充主诉",
								},
							],
						}),
					},
				},
			},
		});
		renderTab();
		await screen.findByText("草稿病例");

		await userEvent.click(screen.getByRole("button", { name: "发布" }));
		await userEvent.click(await screen.findByRole("button", { name: "确认发布" }));

		expect(await screen.findByText("主诉为空")).toBeInTheDocument();
		expect(mocks.toast.apiError).not.toHaveBeenCalled();
	});

	it("归档需要二次确认", async () => {
		mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		renderTab();
		const publishedRow = (await screen.findByText("已发布病例")).closest("tr") as HTMLElement;

		await userEvent.click(within(publishedRow).getByRole("button", { name: "归档" }));
		await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
		expect(mocks.archiveCase).not.toHaveBeenCalled();

		await userEvent.click(within(publishedRow).getByRole("button", { name: "归档" }));
		await waitFor(() => expect(mocks.archiveCase).toHaveBeenCalledWith(PUBLISHED.id));
		await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("病例已归档"));
	});

	it("只有已发布病例能开放/关闭，草稿与归档显示不可用", async () => {
		mocks.getManageCases.mockResolvedValue({
			data: { items: [DRAFT, PUBLISHED, ARCHIVED], total: 3, offset: 0, limit: 50 },
		});
		renderTab();
		const draftRow = (await screen.findByText("草稿病例")).closest("tr") as HTMLElement;
		const publishedRow = screen.getByText("已发布病例").closest("tr") as HTMLElement;
		const archivedRow = screen.getByText("归档病例").closest("tr") as HTMLElement;

		expect(within(draftRow).getByText("待发布")).toBeInTheDocument();
		expect(within(archivedRow).getByText("不可用")).toBeInTheDocument();
		// 只有草稿行有「发布」动作；归档行不能编辑（内容冻结）
		expect(screen.getAllByRole("button", { name: "发布" })).toHaveLength(1);
		expect(within(archivedRow).getByRole("button", { name: "编辑" })).toBeDisabled();
		expect(within(archivedRow).queryByRole("switch")).toBeNull();

		await userEvent.click(within(publishedRow).getByRole("switch", { name: "学生可见 已发布病例" }));
		await waitFor(() => expect(mocks.toggleCaseOpen).toHaveBeenCalledWith(PUBLISHED.id, false));
	});
});
