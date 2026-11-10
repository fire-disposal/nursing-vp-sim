/**
 * 问卷答卷浏览 —— 消费者可见行为回归用例。
 *
 * 锁定第二阶段真正会坏的地方：
 * 1. 统计/答卷/单份答卷都是**可深链的独立页**（id 只从地址栏取，刷新能恢复）；
 * 2. 页面之间能前进/返回：列表 → 详情 → 关联训练记录，以及详情 →「返回答卷列表」；
 * 3. 列表的分页与筛选进的是**请求参数**（不是本地过滤），计数来自服务端 total；
 * 4. 越权/不存在统一「失败关闭」：渲染错误态，绝不渲染成空答卷或 0 数据；
 * 5. 只有真实 record id 才给训练记录入口。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import type * as questionnairesApi from "@/api/questionnaires";
import type { QuestionnaireResponseItem } from "@/api/questionnaires";
import QuestionnaireResponseDetailPage from "@/pages/content/QuestionnaireResponseDetailPage";
import QuestionnaireResponsesPage from "@/pages/content/QuestionnaireResponsesPage";
import QuestionnaireStatsPage from "@/pages/content/QuestionnaireStatsPage";

const {
	getResponsesMock,
	getResponseMock,
	getStatsMock,
	getTemplateMock,
	exportMock,
} = vi.hoisted(() => ({
	getResponsesMock: vi.fn(),
	getResponseMock: vi.fn(),
	getStatsMock: vi.fn(),
	getTemplateMock: vi.fn(),
	exportMock: vi.fn(),
}));

vi.mock("@/api/questionnaires", async (importOriginal) => {
	const actual = await importOriginal<typeof questionnairesApi>();
	return {
		...actual,
		getQuestionnaireResponses: getResponsesMock,
		getQuestionnaireResponse: getResponseMock,
		getQuestionnaireStats: getStatsMock,
		getQuestionnaireTemplate: getTemplateMock,
		exportQuestionnaireCSV: exportMock,
	};
});

const template = {
	id: 3,
	title: "训练前问卷",
	type: "pre",
	description: null,
	is_active: true,
	question_count: 2,
	response_count: 4,
	created_at: "2026-10-01T00:00:00+00:00",
	updated_at: "2026-10-01T00:00:00+00:00",
	questions: [],
	case_ids: [],
};

const response = (over: Partial<QuestionnaireResponseItem> = {}): QuestionnaireResponseItem => ({
	id: 41,
	template_id: 3,
	template_title: "训练前问卷",
	user_id: 9,
	user_name: "甲同学",
	case_id: 5,
	case_name: "社区获得性肺炎",
	record_id: 88,
	status: "completed",
	trigger_event: "after_scoring",
	answers: [
		{
			question_id: 1,
			question_content: "本次训练难度",
			question_type: "likert_5",
			required: true,
			options: null,
			answer_value: "4",
		},
		{
			question_id: 2,
			question_content: "还有补充吗",
			question_type: "short_text",
			required: false,
			options: null,
			answer_value: null,
		},
	],
	completed_at: "2026-10-02T08:30:00+00:00",
	created_at: "2026-10-02T08:00:00+00:00",
	...over,
});

/** 显示当前地址，用来证明「跳转到了哪个页面」而不是只看文案。 */
function LocationProbe() {
	const location = useLocation();
	return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<LocationProbe />
				<Routes>
					<Route path="/admin/questionnaires" element={<div>问卷管理列表</div>} />
					<Route path="/admin/questionnaires/:id/stats" element={<QuestionnaireStatsPage />} />
					<Route path="/admin/questionnaires/:id/responses" element={<QuestionnaireResponsesPage />} />
					<Route
						path="/admin/questionnaires/:id/responses/:responseId"
						element={<QuestionnaireResponseDetailPage />}
					/>
					<Route path="/admin/records/:id" element={<div>训练记录详情页</div>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	getTemplateMock.mockResolvedValue({ data: template });
	getResponsesMock.mockResolvedValue({
		data: { items: [response()], total: 4, offset: 0, limit: 20 },
	});
	getResponseMock.mockResolvedValue({ data: response() });
	getStatsMock.mockResolvedValue({
		data: {
			template_id: 3,
			template_title: "训练前问卷",
			total_assigned: 10,
			total_completed: 4,
			completion_rate: 40,
			questions: [],
		},
	});
});

describe("问卷答卷列表", () => {
	it("从地址栏的问卷 id 取数，并按服务端 total 分页", async () => {
		renderAt("/admin/questionnaires/3/responses");
		await waitFor(() => expect(screen.getByText("甲同学")).toBeInTheDocument());

		// 计数来自后端 total（4），不是当前页条数（1）
		expect(screen.getByText(/共 4 份/)).toBeInTheDocument();
		expect(getResponsesMock).toHaveBeenCalledWith(
			3,
			expect.objectContaining({ offset: 0, limit: 20, status: "completed" }),
		);
	});

	it("触发时点与关联训练记录在列表上可见可跳", async () => {
		renderAt("/admin/questionnaires/3/responses");
		// 等这一行渲染出来（表格在 loading 时只有骨架，没有任何单元格）
		await waitFor(() => expect(screen.getByText("甲同学")).toBeInTheDocument());
		// 「评分后」在筛选下拉里也有一份，用表格内的 Badge 区分
		expect(screen.getAllByText("评分后").length).toBeGreaterThan(1);

		// 关联记录是一个 Anchor，文本即 `#88`
		await userEvent.click(screen.getByTestId("record-link-41"));
		await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/records/88"));
	});

	it("改筛选会把条件送进请求（服务端筛选，不是本地过滤）", async () => {
		renderAt("/admin/questionnaires/3/responses");
		await waitFor(() => expect(screen.getByText("甲同学")).toBeInTheDocument());

		await userEvent.click(screen.getByRole("textbox"));
		await userEvent.type(screen.getByPlaceholderText("搜索学生姓名..."), "甲");

		await waitFor(() =>
			expect(getResponsesMock).toHaveBeenLastCalledWith(3, expect.objectContaining({ search: "甲" })),
		);
	});

	it("点行进入单份答卷详情", async () => {
		renderAt("/admin/questionnaires/3/responses");
		await waitFor(() => expect(screen.getByText("甲同学")).toBeInTheDocument());

		await userEvent.click(screen.getByText("甲同学"));
		await waitFor(() =>
			expect(screen.getByTestId("location")).toHaveTextContent("/admin/questionnaires/3/responses/41"),
		);
	});

	it("取数失败时显示失败态与重试，而不是空列表", async () => {
		getResponsesMock.mockRejectedValue(new Error("boom"));
		renderAt("/admin/questionnaires/3/responses");

		await waitFor(() => expect(screen.getByText("答卷加载失败")).toBeInTheDocument());
		expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
		expect(screen.queryByText("暂无答卷")).not.toBeInTheDocument();
	});
});

describe("单份答卷详情", () => {
	it("展示作答人、触发时点、提交时间与全部答案（含未作答项）", async () => {
		renderAt("/admin/questionnaires/3/responses/41");
		await waitFor(() => expect(screen.getByText("作答内容")).toBeInTheDocument());

		expect(screen.getByTestId("location")).toHaveTextContent("/admin/questionnaires/3/responses/41");
		expect(screen.getByText("甲同学 的答卷")).toBeInTheDocument();
		expect(screen.getByText("评分后")).toBeInTheDocument();
		expect(screen.getByText(/4 · 比较满意/)).toBeInTheDocument();
		// 选答题留空必须显式呈现，而不是整题消失
		expect(screen.getByText("未作答（选答题）")).toBeInTheDocument();
		expect(screen.getByText(/还有补充吗/)).toBeInTheDocument();
	});

	it("有真实 record id 时才给关联训练入口，且能跳过去", async () => {
		renderAt("/admin/questionnaires/3/responses/41");
		await waitFor(() => expect(screen.getByText(/查看关联训练记录 #88/)).toBeInTheDocument());

		await userEvent.click(screen.getByText(/查看关联训练记录 #88/));
		await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/records/88"));
	});

	it("没有 record id 时说明原因，不给死链", async () => {
		getResponseMock.mockResolvedValue({
			data: response({ record_id: null, trigger_event: "before_training" }),
		});
		renderAt("/admin/questionnaires/3/responses/41");
		await waitFor(() =>
			expect(screen.getByText("该答卷在训练前提交，没有关联的训练记录。")).toBeInTheDocument(),
		);
		expect(screen.queryByText(/查看关联训练记录/)).not.toBeInTheDocument();
	});

	it("越权访问失败关闭：404 渲染失败态且不给答案", async () => {
		getResponseMock.mockRejectedValue({ response: { status: 404, data: { detail: "答卷不存在" } } });
		renderAt("/admin/questionnaires/3/responses/41");

		await waitFor(() => expect(screen.getByText("答卷不存在或无权访问")).toBeInTheDocument());
		expect(screen.queryByText("作答内容")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "返回答卷列表" })).toBeInTheDocument();
	});

	it("「返回答卷列表」回到同一问卷的列表路由", async () => {
		renderAt("/admin/questionnaires/3/responses/41");
		await waitFor(() => expect(screen.getByText("作答内容")).toBeInTheDocument());

		await userEvent.click(screen.getByRole("button", { name: "返回答卷列表" }));
		await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/questionnaires/3/responses"));
		// 不是模板列表：仍在同一问卷下
		expect(screen.getByTestId("location").textContent).toBe("/admin/questionnaires/3/responses");
	});
});

describe("问卷统计", () => {
	it("深链直接打开就有数据，并能下钻到答卷列表", async () => {
		renderAt("/admin/questionnaires/3/stats");
		await waitFor(() => expect(screen.getByText("总分配数")).toBeInTheDocument());
		// 后端 `completion_rate` 已是百分数（40 就是 40%）；旧代码又乘了 100 变成 4000%
		expect(screen.getByText("40.0%")).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: /查看答卷/ }));
		await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/questionnaires/3/responses"));
	});

	it("统计取数失败显示失败态，不渲染成全 0 的假报表", async () => {
		getStatsMock.mockRejectedValue(new Error("boom"));
		renderAt("/admin/questionnaires/3/stats");

		await waitFor(() => expect(screen.getByText("统计数据加载失败")).toBeInTheDocument());
		expect(screen.queryByText("总分配数")).not.toBeInTheDocument();
	});

	it("页头返回按钮回到问卷管理列表", async () => {
		renderAt("/admin/questionnaires/3/stats");
		await waitFor(() => expect(screen.getByText("总分配数")).toBeInTheDocument());

		await userEvent.click(screen.getByRole("button", { name: "返回" }));
		await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/questionnaires"));
		expect(screen.getByTestId("location").textContent).toBe("/admin/questionnaires");
	});
});
