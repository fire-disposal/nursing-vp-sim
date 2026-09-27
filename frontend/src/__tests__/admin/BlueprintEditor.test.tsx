import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaseFormModal from "@/components/admin/cases/CaseForm";
import BlueprintEditor, {
	blueprintOf,
	createEmptyBlueprint,
	HISTORY_TAKING_WORKFLOW_ID,
} from "@/components/admin/cases/BlueprintEditor";
import type { CaseDispatch, CaseEditorState, CaseJsonValue } from "@/components/admin/cases/CaseEditorState";
import type { components } from "@/api/api-types.gen";
import type * as ApiModule from "@/api";

type CaseManageItem = components["schemas"]["CaseManageItem"];

/** 保存边界（POST/PUT 载荷）的桩：用来证明「未触碰蓝图 = 载荷里没有 blueprint」不是空口承诺。 */
const apiMocks = vi.hoisted(() => ({
	getCaseDetail: vi.fn(),
	getCaseRevisions: vi.fn(),
	createCase: vi.fn(),
	updateCase: vi.fn(),
	generateCase: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn(), apiError: vi.fn(), warning: vi.fn(), info: vi.fn() },
	confirm: vi.fn(() => true),
}));

vi.mock("@/api", async (importOriginal) => {
	const actual = await importOriginal<typeof ApiModule>();
	return {
		...actual,
		getCaseDetail: apiMocks.getCaseDetail,
		getCaseRevisions: apiMocks.getCaseRevisions,
		createCase: apiMocks.createCase,
		updateCase: apiMocks.updateCase,
		generateCase: apiMocks.generateCase,
	};
});
vi.mock("@/components/Toast", () => ({ useToast: () => apiMocks.toast }));
vi.mock("@/components/ui/confirm", () => ({ useConfirm: () => ({ confirm: apiMocks.confirm }) }));
vi.mock("@monaco-editor/react", () => ({
	default: ({ value }: { value?: string }) => <div data-testid="json-editor">{value ?? ""}</div>,
}));

afterEach(() => {
	apiMocks.getCaseDetail.mockReset();
	apiMocks.updateCase.mockReset();
	apiMocks.toast.success.mockClear();
	localStorage.clear();
});

/**
 * 契约键：与 backend/schemas/case_schema.py::CaseBlueprint 一致（backend 是唯一 owner）。
 * 这里手抄一遍是刻意的 —— 键名变了而作者面没跟上时，这条断言先失败，而不是等发布门禁报错。
 */
const CONTRACT_KEYS = [
	"learning_objectives",
	"prerequisites",
	"clues",
	"must_cover",
	"situational",
	"key_omissions",
	"acceptable_evidence",
	"typical_errors",
	"not_applicable_items",
	"intervention_observable",
	"family_id",
	"variant_role",
	"transfer_of",
	"review",
];

/** 骨架里所有清单键：必须是空数组（值由作者填写，代码不编造内容）。 */
const LIST_KEYS = [
	"learning_objectives",
	"clues",
	"must_cover",
	"situational",
	"key_omissions",
	"acceptable_evidence",
	"typical_errors",
	"not_applicable_items",
];

/** 工作副本夹具：`CaseEditorState` 的字段形状需要逐个锁步，十来处调用共用同一个构造。 */
function makeState(json: Record<string, CaseJsonValue>): CaseEditorState {
	return { json, initialJson: JSON.stringify(json), isDirty: false, mode: "form", undoStack: [] };
}

describe("教学蓝图作者面", () => {
	it("骨架覆盖每个契约键，值全空且不预设内容", () => {
		const bp = createEmptyBlueprint();
		expect(Object.keys(bp).sort()).toEqual([...CONTRACT_KEYS].sort());
		for (const key of LIST_KEYS) expect(bp[key]).toEqual([]);
		expect(bp.prerequisites).toBe("");
		expect(bp.family_id).toBe("");
		expect(bp.transfer_of).toBe("");
		expect(bp.intervention_observable).toBe(false);
		// 后端是 `BlueprintVariantRole | None`：空串会在保存时 422，未声明必须是 null
		expect(bp.variant_role).toBeNull();
		expect(bp.review).toEqual({ editorial_state: "draft", reviewer: "", reviewed_at: "", note: "" });
	});

	it("无 blueprint 的病例：挂载不写任何键（保存载荷保持缺席）", () => {
		const json: Record<string, CaseJsonValue> = { name: "病例", chief_complaint: "咳嗽 3 天" };
		const dispatch = vi.fn();
		render(<BlueprintEditor state={makeState(json)} dispatch={dispatch as unknown as CaseDispatch} />);

		expect(screen.getByText("未声明")).toBeTruthy();
		expect(screen.getByText("维护教学蓝图")).toBeTruthy();
		expect(dispatch).not.toHaveBeenCalled();
		expect("blueprint" in json).toBe(false);
		expect(JSON.stringify(json)).toBe('{"name":"病例","chief_complaint":"咳嗽 3 天"}');
	});

	it("形状非法的 blueprint（手写 JSON）按未声明处理，不写入", () => {
		expect(blueprintOf({ blueprint: "oops" })).toBeNull();
		const dispatch = vi.fn();
		render(<BlueprintEditor state={makeState({ name: "病例", blueprint: "oops" })} dispatch={dispatch as unknown as CaseDispatch} />);
		expect(screen.getByText("未声明")).toBeTruthy();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("勾选「维护教学蓝图」写入骨架；取消勾选删除整个键", async () => {
		const dispatch = vi.fn();
		const { unmount } = render(<BlueprintEditor state={makeState({ name: "病例" })} dispatch={dispatch as unknown as CaseDispatch} />);
		await userEvent.click(screen.getByRole("checkbox", { name: /维护教学蓝图/ }));

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0]).toEqual({
			type: "SET_FIELD",
			path: "blueprint",
			value: createEmptyBlueprint(),
		});
		unmount();

		const dispatch2 = vi.fn();
		render(<BlueprintEditor state={makeState({ name: "病例", blueprint: createEmptyBlueprint() })} dispatch={dispatch2 as unknown as CaseDispatch} />);
		await userEvent.click(screen.getByRole("checkbox", { name: /维护教学蓝图/ }));

		expect(dispatch2).toHaveBeenCalledTimes(1);
		const action = dispatch2.mock.calls[0][0] as { type: string; json: Record<string, CaseJsonValue> };
		expect(action.type).toBe("SET_JSON");
		expect("blueprint" in action.json).toBe(false);
		expect(action.json).toEqual({ name: "病例" });
	});

	it("清单只写自己那一组键，不动蓝图里的其他内容", async () => {
		const blueprint = createEmptyBlueprint();
		const json: Record<string, CaseJsonValue> = { name: "病例", blueprint };
		const dispatch = vi.fn();
		render(<BlueprintEditor state={makeState(json)} dispatch={dispatch as unknown as CaseDispatch} />);

		await userEvent.type(screen.getByLabelText("学习目标条目"), "识别低氧{Enter}");

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0]).toEqual({
			type: "SET_FIELD",
			path: "blueprint.learning_objectives",
			value: ["识别低氧"],
		});
		// 编辑态未被就地改写：工作副本仍只有骨架内容
		expect(blueprint.learning_objectives).toEqual([]);
	});

	it("不适用评分项给出 rubric 条目 id 的提示", () => {
		render(<BlueprintEditor state={makeState({ name: "病例", blueprint: createEmptyBlueprint() })} dispatch={vi.fn() as unknown as CaseDispatch} />);
		expect(screen.getByText(/填基准 rubric 的条目 id/)).toBeTruthy();
		expect(screen.getByLabelText("不适用评分项条目")).toBeTruthy();
	});

	it("添加线索使用合法来源枚举与空内容", async () => {
		const dispatch = vi.fn();
		render(<BlueprintEditor state={makeState({ name: "病例", blueprint: createEmptyBlueprint() })} dispatch={dispatch as unknown as CaseDispatch} />);

		await userEvent.click(screen.getByRole("button", { name: "添加线索" }));

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0]).toEqual({
			type: "SET_FIELD",
			path: "blueprint.clues",
			value: [{ id: "", label: "", source: "inquiry", significance: "" }],
		});
	});

	it("迁移变式角色写枚举值，取消选择写 null（后端枚举不接受空串）", async () => {
		const dispatch = vi.fn();
		const { unmount } = render(<BlueprintEditor state={makeState({ name: "病例", blueprint: createEmptyBlueprint() })} dispatch={dispatch as unknown as CaseDispatch} />);

		const pickRole = async (input: HTMLElement) => {
			await userEvent.click(input);
			const listbox = document.getElementById(input.getAttribute("aria-controls") ?? "");
			await userEvent.click(within(listbox as HTMLElement).getByRole("option", { name: "迁移变式", hidden: true }));
		};

		await pickRole(screen.getByRole("combobox", { name: "家族内角色" }));
		expect(dispatch.mock.calls[0][0]).toEqual({ type: "SET_FIELD", path: "blueprint.variant_role", value: "transfer" });
		unmount();

		const dispatch2 = vi.fn();
		render(
			<BlueprintEditor
				state={makeState({ name: "病例", blueprint: { ...createEmptyBlueprint(), variant_role: "transfer" } })}
				dispatch={dispatch2 as unknown as CaseDispatch}
			/>,
		);
		// 再点一次已选项 = 取消选择（Select 默认 allowDeselect）
		await pickRole(screen.getByRole("combobox", { name: "家族内角色" }));
		expect(dispatch2.mock.calls[0][0]).toEqual({ type: "SET_FIELD", path: "blueprint.variant_role", value: null });
	});

	it("非问诊 workflow 的病例不给编辑入口（蓝图放进去不会被消费）", () => {
		const dispatch = vi.fn();
		render(
			<BlueprintEditor
				state={makeState({ name: "病例", workflow: "clinical_reasoning", blueprint: createEmptyBlueprint() })}
				dispatch={dispatch as unknown as CaseDispatch}
			/>,
		);

		expect(screen.queryByText("维护教学蓝图")).toBeNull();
		expect(screen.getByText(/只属于问诊病例/)).toBeTruthy();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it(`workflow=${HISTORY_TAKING_WORKFLOW_ID} 或未声明时照常提供入口`, () => {
		const { unmount } = render(
			<BlueprintEditor state={makeState({ name: "病例", workflow: HISTORY_TAKING_WORKFLOW_ID })} dispatch={vi.fn() as unknown as CaseDispatch} />,
		);
		expect(screen.getByText("维护教学蓝图")).toBeTruthy();
		unmount();

		render(<BlueprintEditor state={makeState({ name: "病例", workflow: "  " })} dispatch={vi.fn() as unknown as CaseDispatch} />);
		expect(screen.getByText("维护教学蓝图")).toBeTruthy();
	});

	it("归档（disabled）时不可勾选启用", async () => {
		const dispatch = vi.fn();
		render(<BlueprintEditor state={makeState({ name: "病例" })} dispatch={dispatch as unknown as CaseDispatch} disabled />);

		const card = screen.getByRole("checkbox", { name: /维护教学蓝图/ });
		expect(card).toBeDisabled();
		await userEvent.click(card);
		expect(dispatch).not.toHaveBeenCalled();
	});
});

const CASE_ITEM: CaseManageItem = {
	id: 7,
	name: "咳嗽病例",
	description: "老年男性咳嗽 3 天",
	status: "draft",
	current_revision_id: null,
	current_revision_no: null,
	patient_name: "王大爷",
	patient_age: 68,
	patient_gender: "男",
	chief_complaint: "咳嗽 3 天",
	time_limit: 30,
	difficulty: 2,
	patient_personality: "焦虑",
	capabilities: {},
	is_open: false,
	created_at: "2026-01-01T00:00:00Z",
	training_count: 0,
};

describe("教学蓝图与保存载荷", () => {
	it("打开未声明蓝图的病例再保存：载荷与打开时一致，不含 blueprint 键", async () => {
		apiMocks.getCaseDetail.mockResolvedValue({
			data: {
				id: 7,
				name: "咳嗽病例",
				description: "老年男性咳嗽 3 天",
				case_data: { chief_complaint: "咳嗽 3 天", patient_info: { name: "王大爷", age: 68, gender: "男" } },
				status: "draft",
				is_open: false,
				difficulty: 2,
				time_limit_minutes: 30,
				current_revision_id: null,
				current_revision_no: null,
			},
		});
		apiMocks.updateCase.mockResolvedValue({ data: {} });

		const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={qc}>
				<CaseFormModal
					open
					editingCase={CASE_ITEM}
					startWithAiPanel={false}
					availableCases={[]}
					onClose={() => {}}
					onSaved={() => {}}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() => expect(screen.getByDisplayValue("咳嗽病例")).toBeTruthy());
		// 表单里渲染出了蓝图区块，但作者没有触碰它
		expect(screen.getByText("教学蓝图")).toBeTruthy();
		expect(screen.getByText("未声明")).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() => expect(apiMocks.updateCase).toHaveBeenCalled());
		const [, payload] = apiMocks.updateCase.mock.calls[0] as [number, { case_data: Record<string, unknown> }];
		expect("blueprint" in payload.case_data).toBe(false);
		expect(payload.case_data).toEqual(
			expect.objectContaining({
				name: "咳嗽病例",
				description: "老年男性咳嗽 3 天",
				difficulty: 2,
				time_limit: 30,
				chief_complaint: "咳嗽 3 天",
			}),
		);
	});

	it("勾选启用后保存：载荷带上骨架（键与后端契约一致）", async () => {
		apiMocks.getCaseDetail.mockResolvedValue({
			data: {
				id: 7,
				name: "咳嗽病例",
				description: "老年男性咳嗽 3 天",
				case_data: { chief_complaint: "咳嗽 3 天" },
				status: "draft",
				is_open: false,
				difficulty: 2,
				time_limit_minutes: 30,
				current_revision_id: null,
				current_revision_no: null,
			},
		});
		apiMocks.updateCase.mockResolvedValue({ data: {} });

		const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={qc}>
				<CaseFormModal
					open
					editingCase={CASE_ITEM}
					startWithAiPanel={false}
					availableCases={[]}
					onClose={() => {}}
					onSaved={() => {}}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() => expect(screen.getByDisplayValue("咳嗽病例")).toBeTruthy());
		await userEvent.click(screen.getByRole("checkbox", { name: /维护教学蓝图/ }));
		await userEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() => expect(apiMocks.updateCase).toHaveBeenCalled());
		const [, payload] = apiMocks.updateCase.mock.calls[0] as [number, { case_data: Record<string, unknown> }];
		expect(Object.keys(payload.case_data.blueprint as object).sort()).toEqual([...CONTRACT_KEYS].sort());
	});
});
