/**
 * 病例工作台（独立页）—— 回归用例。
 *
 * 覆盖这次迁移真正会坏的地方：
 * 1. 新建/编辑/AI 生成进的是可深链的独立页，不是列表里的弹窗；
 * 2. 深链 + 刷新能恢复对应病例（id 只从地址栏取）；
 * 3. 版本历史是页内面板（不再叠第二层 Modal）；
 * 4. 已归档病例只读、不能保存；
 * 5. 新建保存成功后换成该病例的深链。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import type * as coreApi from "@/api";
import type { components } from "@/api/api-types.gen";
import { editCasePath, newCasePath } from "@/components/admin/cases/CaseForm";
import CaseWorkspacePage from "@/pages/content/CaseWorkspacePage";

type CaseDetail = components["schemas"]["CaseDetail"];
type CaseManageItem = components["schemas"]["CaseManageItem"];
type CaseRevisionItem = components["schemas"]["CaseRevisionItem"];

const {
	getCaseDetailMock,
	getManageCasesMock,
	getCaseRevisionsMock,
	getCaseValidationMock,
	updateCaseMock,
	createCaseMock,
	publishCaseMock,
	suggestCaseMock,
} = vi.hoisted(() => ({
	getCaseDetailMock: vi.fn(),
	getManageCasesMock: vi.fn(),
	getCaseRevisionsMock: vi.fn(),
	getCaseValidationMock: vi.fn(),
	updateCaseMock: vi.fn(),
	createCaseMock: vi.fn(),
	publishCaseMock: vi.fn(),
	suggestCaseMock: vi.fn(),
}));

vi.mock("@/api", async (importOriginal) => {
	const actual = await importOriginal<typeof coreApi>();
	return {
		...actual,
		getCaseDetail: getCaseDetailMock,
		getManageCases: getManageCasesMock,
		getCaseRevisions: getCaseRevisionsMock,
		getCaseValidation: getCaseValidationMock,
		updateCase: updateCaseMock,
		createCase: createCaseMock,
		publishCase: publishCaseMock,
		suggestCase: suggestCaseMock,
	};
});

const detail = (over: Partial<CaseDetail> = {}): CaseDetail => ({
	id: 7,
	name: "社区获得性肺炎",
	description: "呼吸科",
	case_data: {
		chief_complaint: "发热咳嗽 3 天",
		present_illness: "受凉后起病",
		opening_line: "护士您好，我咳嗽得厉害",
		patient_info: { name: "王先生", age: 62, gender: "男" },
	},
	status: "draft",
	is_open: false,
	difficulty: 1,
	time_limit_minutes: 30,
	current_revision_no: null,
	...over,
} as CaseDetail);

const manageItem = (over: Partial<CaseManageItem> = {}): CaseManageItem => ({
	id: 7,
	name: "社区获得性肺炎",
	status: "draft",
	difficulty: 1,
	is_open: false,
	current_revision_no: null,
	training_count: 0,
	...over,
} as CaseManageItem);

function renderAt(path: string) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route path="/admin/cases" element={<div>病例库列表</div>} />
					<Route path="/admin/cases/new" element={<CaseWorkspacePage />} />
					<Route path="/admin/cases/:caseId" element={<CaseWorkspacePage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	getCaseDetailMock.mockResolvedValue({ data: detail() });
	getManageCasesMock.mockResolvedValue({ data: { items: [], total: 0, offset: 0, limit: 100 } });
	getCaseRevisionsMock.mockResolvedValue({ data: [] as CaseRevisionItem[] });
	getCaseValidationMock.mockResolvedValue({
		data: { case_id: 7, case_name: "社区获得性肺炎", errors: [], warnings: [], infos: [], publishable: true },
	});
	publishCaseMock.mockResolvedValue({
		data: { case: manageItem({ status: "published", current_revision_no: 1 }), revision_no: 1 },
	});
	updateCaseMock.mockResolvedValue({ data: manageItem() });
	createCaseMock.mockResolvedValue({ data: manageItem() });
	suggestCaseMock.mockResolvedValue({
		data: {
			suggestions: [{ field: "scenario", title: "补全场景边界", detail: "说明学生开局知道什么。" }],
			elapsed_ms: 10,
			usage: null,
		},
	});
});

describe("工作台路由地址", () => {
	it("新建与编辑都是可深链地址，AI 生成用 query 表达", () => {
		expect(newCasePath()).toBe("/admin/cases/new");
		expect(newCasePath({ ai: true })).toBe("/admin/cases/new?mode=ai");
		expect(editCasePath(7)).toBe("/admin/cases/7");
	});
});

describe("病例工作台页", () => {
	it("深链 /admin/cases/7 载入该病例（刷新可恢复）", async () => {
		renderAt("/admin/cases/7");

		await waitFor(() => expect(getCaseDetailMock).toHaveBeenCalledWith(7));
		// 名称进标题，患者/主诉来自详情内容
		await waitFor(() => expect(screen.getByDisplayValue("社区获得性肺炎")).toBeInTheDocument());
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("非数字路径不请求详情（当作页面不存在）", async () => {
		renderAt("/admin/cases/abc");

		await waitFor(() => expect(screen.getByText("页面不存在")).toBeInTheDocument());
		expect(getCaseDetailMock).not.toHaveBeenCalled();
	});

	it("V1 默认收起教学分区，需要时展开人格与沟通", async () => {
		renderAt("/admin/cases/new");
		const user = userEvent.setup();

		expect(screen.queryByText("人格配置")).not.toBeVisible();
		await user.click(screen.getByRole("button", { name: /人格与沟通/ }));
		expect(await screen.findByText("人格配置")).toBeInTheDocument();
	});

	it("逐字段 AI 操作默认收进高级区", async () => {
		renderAt("/admin/cases/new?mode=ai");
		const user = userEvent.setup();

		expect(screen.queryByRole("button", { name: "主诉" })).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "高级：指定字段完善" }));
		expect(await screen.findByRole("button", { name: "主诉" })).toBeInTheDocument();
	});

	it("新建：不请求详情，显示默认骨架与「创建草稿」", async () => {
		renderAt("/admin/cases/new");

		await waitFor(() => expect(screen.getByRole("button", { name: "创建草稿" })).toBeInTheDocument());
		expect(getCaseDetailMock).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("AI 生成入口（?mode=ai）进入即展开 AI 面板", async () => {
		renderAt("/admin/cases/new?mode=ai");

		await waitFor(() => expect(screen.getByRole("button", { name: /生成临床骨架/ })).toBeInTheDocument());
	});

	it("新建可选择 V2 模板，V3 仅作不可用的未来说明", async () => {
		renderAt("/admin/cases/new?mode=ai");
		const user = userEvent.setup();

		const v3 = screen.getByRole("radio", { name: /V3/ });
		expect(v3).toBeDisabled();
		await user.click(screen.getByRole("radio", { name: /V2/ }));

		expect(await screen.findByRole("tab", { name: /场景与患者/ })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /证据目录/ })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /评分锚点/ })).toBeInTheDocument();
		expect(screen.queryByText(/JSON 里需要哪些字段/)).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /生成临床骨架/ })).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "获取建议" }));
		expect(await screen.findByText("补全场景边界")).toBeInTheDocument();
		expect(suggestCaseMock).toHaveBeenCalledWith(
			expect.objectContaining({ workflow: "clinical_reasoning" }),
		);
	});

	it("V1 AI 审阅读取当前工作副本且不会自动应用建议", async () => {
		renderAt("/admin/cases/new?mode=ai");
		const user = userEvent.setup();

		await user.click(screen.getByRole("radio", { name: "审阅建议" }));
		await user.click(await screen.findByRole("button", { name: "获取建议" }));

		expect(await screen.findByText("说明学生开局知道什么。")).toBeInTheDocument();
		expect(suggestCaseMock).toHaveBeenCalledWith(
			expect.objectContaining({ workflow: "history_taking", current_case_data: expect.any(Object) }),
		);
		expect(createCaseMock).not.toHaveBeenCalled();
	});

	it("V2 教师表单编辑会写入对应代际的创建载荷", async () => {
		renderAt("/admin/cases/new");
		const user = userEvent.setup();

		await user.click(screen.getByRole("radio", { name: /V2/ }));
		fireEvent.change(screen.getByRole("textbox", { name: "病例名称" }), { target: { value: "术后低氧训练" } });
		fireEvent.change(screen.getByRole("textbox", { name: "场景标题" }), { target: { value: "夜间术后低氧" } });
		await user.click(screen.getByRole("button", { name: "创建草稿" }));

		await waitFor(() => expect(createCaseMock).toHaveBeenCalledTimes(1));
		expect(createCaseMock.mock.calls[0][0].case_data).toMatchObject({
			workflow: "clinical_reasoning",
			name: "术后低氧训练",
			scenario: { title: "夜间术后低氧" },
		});
	});

	it("版本历史是页内面板，不再打开第二层 Modal", async () => {
		getCaseRevisionsMock.mockResolvedValue({
			data: [{ id: 1, revision_no: 1, created_at: "2026-10-01T08:00:00+08:00", published_at: null, is_current: true }],
		});
		renderAt("/admin/cases/7");

		const user = userEvent.setup();
		await waitFor(() => expect(screen.getByRole("button", { name: /版本历史/ })).toBeInTheDocument());
		await user.click(screen.getByRole("button", { name: /版本历史/ }));

		await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());
		// 面板在页面里（无 dialog），且能收起
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "收起" }));
		await waitFor(() => expect(screen.queryByText("v1")).not.toBeInTheDocument());
	});

	it("已归档病例只读：保存按钮禁用并说明原因", async () => {
		getCaseDetailMock.mockResolvedValue({ data: detail({ status: "archived" }) });
		renderAt("/admin/cases/7");

		await waitFor(() =>
			expect(screen.getByText(/该病例已归档，内容已冻结、不能再编辑/)).toBeInTheDocument(),
		);
		const submit = screen.getByRole("button", { name: /保存/ });
		expect(submit).toBeDisabled();
	});

	it("已发布病例保存按钮表达「产生新版本」", async () => {
		getCaseDetailMock.mockResolvedValue({
			data: detail({ status: "published", current_revision_no: 3 }),
		});
		renderAt("/admin/cases/7");

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "保存为新版本" })).toBeInTheDocument(),
		);
	});

	it("发布：先看门禁报告；有 error 时不能发布", async () => {
		getCaseValidationMock.mockResolvedValue({
			data: {
				case_id: 7,
				case_name: "社区获得性肺炎",
				errors: [{ severity: "error", field: "chief_complaint", message: "主诉不能为空", fix_hint: "填写主诉" }],
				warnings: [],
				infos: [],
				publishable: false,
			},
		});
		renderAt("/admin/cases/7");

		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "发布" }));

		await waitFor(() => expect(screen.getByText(/未通过发布门禁/)).toBeInTheDocument());
		expect(screen.getByRole("button", { name: "确认发布" })).toBeDisabled();
		expect(publishCaseMock).not.toHaveBeenCalled();
	});

	it("发布：门禁通过后发布该病例并刷新详情", async () => {
		renderAt("/admin/cases/7");

		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "发布" }));

		await waitFor(() => expect(screen.getByText(/通过发布门禁/)).toBeInTheDocument());
		const confirm = screen.getByRole("button", { name: "确认发布" });
		await waitFor(() => expect(confirm).toBeEnabled());
		await user.click(confirm);

		await waitFor(() => expect(publishCaseMock).toHaveBeenCalledWith(7));
	});

	it("加载失败给出失败态与重试，且不显示可保存的骨架", async () => {
		getCaseDetailMock.mockRejectedValue({ response: { status: 500 } });
		renderAt("/admin/cases/7");

		await waitFor(() => expect(screen.getByText("加载病例失败")).toBeInTheDocument());
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "创建草稿" })).not.toBeInTheDocument();
	});

	it("新建保存成功后换成该病例的深链（刷新仍是这份病例）", async () => {
		renderAt("/admin/cases/new");

		const user = userEvent.setup();
		const submit = await screen.findByRole("button", { name: "创建草稿" });
		// 空名称过不了本地表单校验：先填名称，再创建
		await user.type(screen.getByPlaceholderText("例：急性阑尾炎"), "社区获得性肺炎");
		await user.click(submit);

		await waitFor(() => expect(createCaseMock).toHaveBeenCalledTimes(1));
		expect(createCaseMock.mock.calls[0][0]).toMatchObject({ is_open: false });
		// replace 到 /admin/cases/7 会触发详情加载
		await waitFor(() => expect(getCaseDetailMock).toHaveBeenCalledWith(7));
	});
});
