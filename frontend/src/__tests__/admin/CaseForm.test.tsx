import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaseFormModal from "@/components/admin/cases/CaseForm";
import type * as ApiModule from "@/api";
import type { components } from "@/api/api-types.gen";

type CaseManageItem = components["schemas"]["CaseManageItem"];

const mocks = vi.hoisted(() => ({
	generateCase: vi.fn(),
	getCaseDetail: vi.fn(),
	getCaseRevisions: vi.fn(),
	createCase: vi.fn(),
	updateCase: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn(), apiError: vi.fn(), warning: vi.fn(), info: vi.fn() },
	confirm: vi.fn(() => true),
}));

vi.mock("@/api", async (importOriginal) => {
	const actual = await importOriginal<typeof ApiModule>();
	return {
		...actual,
		generateCase: mocks.generateCase,
		getCaseDetail: mocks.getCaseDetail,
		getCaseRevisions: mocks.getCaseRevisions,
		createCase: mocks.createCase,
		updateCase: mocks.updateCase,
	};
});

vi.mock("@/components/Toast", () => ({
	useToast: () => mocks.toast,
}));

vi.mock("@/components/ui/confirm", () => ({
	useConfirm: () => ({ confirm: mocks.confirm }),
}));

// JSON 视图用 Monaco：jsdom 里没有 monaco 运行时，用只读节点替身让断言能读到 JSON 文本。
vi.mock("@monaco-editor/react", () => ({
	default: ({ value }: { value?: string }) => (
		<div data-testid="json-editor">{value ?? ""}</div>
	),
}));

const BASE_CASE_ITEM: CaseManageItem = {
	id: 11,
	name: "病例",
	description: null,
	status: "draft",
	current_revision_id: null,
	current_revision_no: null,
	patient_name: "王大爷",
	patient_age: 68,
	patient_gender: "男",
	chief_complaint: "咳嗽",
	time_limit: 30,
	difficulty: 2,
	patient_personality: "焦虑",
	capabilities: {},
	is_open: false,
	created_at: "2026-01-01T00:00:00Z",
	training_count: 0,
};

function renderModal(overrides?: { editingCase?: Partial<CaseManageItem> | null }) {
	const editingCase = overrides?.editingCase
		? { ...BASE_CASE_ITEM, ...overrides.editingCase }
		: null;
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<CaseFormModal
				open={true}
				editingCase={editingCase}
				startWithAiPanel={false}
				availableCases={[]}
				onClose={() => {}}
				onSaved={() => {}}
			/>
		</QueryClientProvider>,
	);
}

afterEach(() => {
	mocks.generateCase.mockReset();
	mocks.getCaseDetail.mockReset();
	mocks.toast.success.mockClear();
	localStorage.clear();
});

describe("CaseForm AI 两步向导", () => {
	it("生成临床骨架：携带 stage=core 并填充表单", async () => {
		mocks.generateCase.mockResolvedValue({
			data: {
				case_data: {
					name: "肺炎患者",
					chief_complaint: "咳嗽伴发热3天",
					present_illness: "3天前受凉后咳嗽",
					patient_info: { name: "王大爷", age: 65, gender: "男" },
				},
			},
		});
		renderModal();

		await userEvent.click(screen.getByRole("button", { name: /AI/ }));
		await userEvent.type(screen.getByPlaceholderText(/描述你想生成的病例场景/), "老年男性，咳嗽发热3天");

		const coreBtn = screen.getByRole("button", { name: "生成临床骨架" });
		await userEvent.click(coreBtn);

		await waitFor(() => {
			expect(mocks.generateCase).toHaveBeenCalledTimes(1);
		});
		const payload = mocks.generateCase.mock.calls[0][0] as { stage: string };
		expect(payload.stage).toBe("core");

		// 生成结果填充表单 → 撤销按钮出现
		await waitFor(() => {
			expect(mocks.toast.success).toHaveBeenCalledWith(expect.stringContaining("临床骨架"));
		});
		expect(screen.getByRole("button", { name: /撤销/ })).toBeTruthy();
	});

	it("生成教学细节：携带 stage=derivative 与当前病例上下文", async () => {
		mocks.generateCase.mockResolvedValue({
			data: {
				case_data: {
					hidden_info: ["吸烟30年"],
					required_inquiries: ["吸烟史"],
				},
			},
		});
		renderModal();

		await userEvent.click(screen.getByRole("button", { name: /AI/ }));
		await userEvent.type(screen.getByPlaceholderText(/描述你想生成的病例场景/), "老年肺炎");

		const detailBtn = screen.getByRole("button", { name: "生成教学细节" });
		await userEvent.click(detailBtn);

		await waitFor(() => {
			expect(mocks.generateCase).toHaveBeenCalledTimes(1);
		});
		const payload = mocks.generateCase.mock.calls[0][0] as { stage: string; current_case_data?: unknown };
		expect(payload.stage).toBe("derivative");
		expect(payload.current_case_data).toBeTruthy();
	});

	it("逐字段生成：携带 field=present_illness", async () => {
		mocks.generateCase.mockResolvedValue({
			data: { field_value: "3天前受凉后咳嗽加重，夜间为甚", field: "present_illness" },
		});
		renderModal();

		await userEvent.click(screen.getByRole("button", { name: /AI/ }));
		await userEvent.type(screen.getByPlaceholderText(/描述你想生成的病例场景/), "咳嗽病例");

		await userEvent.click(screen.getByRole("button", { name: "现病史" }));

		await waitFor(() => {
			expect(mocks.generateCase).toHaveBeenCalledTimes(1);
		});
		const payload = mocks.generateCase.mock.calls[0][0] as { field: string };
		expect(payload.field).toBe("present_illness");
		await waitFor(() => {
			expect(mocks.toast.success).toHaveBeenCalledWith(expect.stringContaining("现病史"));
		});
	});

	it("描述为空时生成骨架给出提示", async () => {
		renderModal();
		await userEvent.click(screen.getByRole("button", { name: /AI/ }));

		await userEvent.click(screen.getByRole("button", { name: "生成临床骨架" }));

		await waitFor(() => {
			expect(screen.getByText("请输入病例描述")).toBeTruthy();
		});
		expect(mocks.generateCase).not.toHaveBeenCalled();
	});
});

const PUBLISHED_CASE = { id: 11, name: "已发布病例", status: "published", current_revision_no: 2 };

/** 病例列上的元数据出参（case_data 已不含三键）。 */
const DETAIL_PAYLOAD = {
	id: 11,
	name: "已发布病例",
	description: "老年男性咳嗽 3 天",
	case_data: { chief_complaint: "咳嗽 3 天", patient_info: { name: "王大爷", age: 68, gender: "男" } },
	status: "published",
	is_open: true,
	difficulty: 2,
	time_limit_minutes: 45,
	current_revision_id: 21,
	current_revision_no: 2,
};

describe("CaseForm 生命周期", () => {
	it("加载时把病例列元数据合并进工作副本，保存原样回传", async () => {
		mocks.getCaseDetail.mockResolvedValue({ data: DETAIL_PAYLOAD });
		mocks.updateCase.mockResolvedValue({ data: {} });
		renderModal({ editingCase: PUBLISHED_CASE });

		await waitFor(() => expect(screen.getByDisplayValue("已发布病例")).toBeTruthy());

		await userEvent.click(screen.getByRole("button", { name: "保存为新版本" }));

		await waitFor(() => expect(mocks.updateCase).toHaveBeenCalled());
		const [, payload] = mocks.updateCase.mock.calls[0] as [number, { case_data: Record<string, unknown> }];
		expect(payload.case_data).toEqual(
			expect.objectContaining({
				name: "已发布病例",
				description: "老年男性咳嗽 3 天",
				difficulty: 2,
				time_limit: 45,
				chief_complaint: "咳嗽 3 天",
			}),
		);
	});

	it("已发布病例提示将产生新版本，并可从版本历史看到当前版本", async () => {
		mocks.getCaseDetail.mockResolvedValue({ data: DETAIL_PAYLOAD });
		mocks.getCaseRevisions.mockResolvedValue({
			data: [
				{
					id: 21,
					revision_no: 2,
					created_at: "2026-02-01T00:00:00Z",
					created_by: 3,
					published_at: "2026-02-01T00:00:00Z",
					is_current: true,
				},
				{
					id: 20,
					revision_no: 1,
					created_at: "2026-01-01T00:00:00Z",
					created_by: 3,
					published_at: "2026-01-01T00:00:00Z",
					is_current: false,
				},
			],
		});
		renderModal({ editingCase: PUBLISHED_CASE });

		expect(await screen.findByText(/已发布（当前 v2）/)).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: /版本历史/ }));

		expect(await screen.findByText("v1")).toBeTruthy();
		expect(screen.getByText("当前版本")).toBeTruthy();
	});

	it("已发布病例保存被门禁拒绝时展示字段级报告", async () => {
		mocks.getCaseDetail.mockResolvedValue({ data: DETAIL_PAYLOAD });
		mocks.updateCase.mockRejectedValue({
			response: {
				data: {
					detail: {
						code: "CASE_NOT_PUBLISHABLE",
						message: "病例未通过发布门禁：1 个 error",
						report: {
							case_id: 11,
							case_name: "已发布病例",
							publishable: false,
							errors: [
								{
									severity: "error",
									field: "present_illness",
									message: "现病史为空",
									fix_hint: "补充现病史",
								},
							],
							warnings: [],
							infos: [],
						},
					},
				},
			},
		});
		renderModal({ editingCase: PUBLISHED_CASE });

		await waitFor(() => expect(screen.getByDisplayValue("已发布病例")).toBeTruthy());
		await userEvent.click(screen.getByRole("button", { name: "保存为新版本" }));

		expect(await screen.findByText("现病史为空")).toBeTruthy();
		expect(mocks.toast.success).not.toHaveBeenCalled();
	});

	it("新建病例以 draft 提交且不自动开放", async () => {
		mocks.createCase.mockResolvedValue({ data: {} });
		renderModal();

		await userEvent.type(screen.getByPlaceholderText("例：急性阑尾炎"), "新病例");
		await userEvent.click(screen.getByRole("button", { name: "创建草稿" }));

		await waitFor(() => expect(mocks.createCase).toHaveBeenCalled());
		const [payload] = mocks.createCase.mock.calls[0] as [
			{ is_open: boolean; case_data: Record<string, unknown> },
		];
		expect(payload.is_open).toBe(false);
		expect(payload.case_data).toEqual(expect.objectContaining({ name: "新病例", time_limit: 30 }));
	});

	it("已归档病例内容冻结：保存禁用", async () => {
		mocks.getCaseDetail.mockResolvedValue({
			data: { ...DETAIL_PAYLOAD, status: "archived", current_revision_no: 2 },
		});
		renderModal({ editingCase: { ...PUBLISHED_CASE, status: "archived" } });

		expect(await screen.findByText(/已归档，内容已冻结/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
	});
});

