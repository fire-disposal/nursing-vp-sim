import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeManifest } from "@/__tests__/fixtures/manifest";
import TrainingEntry from "@/pages/TrainingEntry";

/**
 * before_training 必答问卷：题目拿不到时，旧实现里弹窗直接 `return null` 静默消失 ——
 * 学生看到的是空屏，而必答问卷未完成前工作区又被挡住，等于彻底卡死。
 * 这里钉住：可见说明 + 重试可用；同时 happy path（题目就绪 / 无待答）行为不变。
 */
const apiMock = vi.hoisted(() => ({
	getRecordDetail: vi.fn(),
	resumeTraining: vi.fn(),
	pauseTraining: vi.fn(),
	pauseTrainingOnHide: vi.fn(),
	checkQuestionnaire: vi.fn(),
	submitQuestionnaire: vi.fn(),
}));

// 页面用 "../api/training" 相对导入，与别名解析到同一个模块
vi.mock("@/api/training", () => ({
	getRecordDetail: apiMock.getRecordDetail,
	resumeTraining: apiMock.resumeTraining,
	pauseTraining: apiMock.pauseTraining,
	pauseTrainingOnHide: apiMock.pauseTrainingOnHide,
}));

vi.mock("@/api/questionnaires", () => ({
	checkQuestionnaire: apiMock.checkQuestionnaire,
	submitQuestionnaire: apiMock.submitQuestionnaire,
}));

// 工作区本身与问卷无关：换成占位组件，只验「要不要进工作区 / 问卷是否可见」
vi.mock("@/components/training/scenes/scene-registry", () => ({
	TRAINING_SCENES: {
		history_taking: () => <div>病史采集工作区</div>,
	},
}));

const RECORD = {
	id: 7,
	case_id: 1,
	mode: "guided",
	status: "in_progress",
	manifest: makeManifest(),
	messages: [],
};

const TEMPLATE = {
	id: 9,
	title: "前测问卷",
	description: null,
	is_active: true,
	question_count: 1,
	response_count: 0,
	questions: [
		{
			id: 91,
			content: "训练前请如实填写你的感受",
			question_type: "short_text",
			required: true,
			sort_order: 1,
			options: null,
		},
	],
};

const NO_PENDING = { has_pending: false, is_required: false, trigger_event: "before_training" };

function renderEntry() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/training/7"]}>
				<Routes>
					<Route path="/training/:recordId" element={<TrainingEntry />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	apiMock.getRecordDetail.mockResolvedValue({ data: RECORD });
	apiMock.resumeTraining.mockResolvedValue({ data: {} });
	apiMock.pauseTraining.mockResolvedValue({ data: {} });
	apiMock.pauseTrainingOnHide.mockResolvedValue({ data: {} });
	apiMock.checkQuestionnaire.mockResolvedValue({ data: NO_PENDING });
	apiMock.submitQuestionnaire.mockResolvedValue({ data: {} });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("训练入口 · before_training 必答问卷", () => {
	it("模板拿不到：给出可见说明与重试入口，而不是空白卡死", async () => {
		apiMock.checkQuestionnaire.mockResolvedValue({
			data: {
				has_pending: true,
				template_id: 9,
				template: null,
				is_required: true,
				trigger_event: "before_training",
			},
		});

		renderEntry();

		expect(await screen.findByText("问卷加载失败")).toBeInTheDocument();
		expect(screen.getByText(/你的作答尚未被记录/)).toBeInTheDocument();
		// 必答未完成前不进工作区（原语义保留），但现在至少不是空白
		expect(screen.queryByText("病史采集工作区")).not.toBeInTheDocument();

		const callsBeforeRetry = apiMock.checkQuestionnaire.mock.calls.length;
		await userEvent.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() =>
			expect(apiMock.checkQuestionnaire.mock.calls.length).toBeGreaterThan(callsBeforeRetry),
		);
	});

	it("题目就绪：弹窗照常出现，工作区仍被必答问卷挡住（happy path 不变）", async () => {
		apiMock.checkQuestionnaire.mockResolvedValue({
			data: {
				has_pending: true,
				template_id: 9,
				template: TEMPLATE,
				is_required: true,
				trigger_event: "before_training",
			},
		});

		renderEntry();

		expect(await screen.findByText("前测问卷")).toBeInTheDocument();
		expect(screen.getByText(/训练前请如实填写你的感受/)).toBeInTheDocument();
		expect(screen.queryByText("病史采集工作区")).not.toBeInTheDocument();
		// happy path 不多发请求、不出现失败提示
		expect(apiMock.checkQuestionnaire).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("问卷加载失败")).not.toBeInTheDocument();
	});

	it("无待答：直接进工作区，且不出现任何问卷提示", async () => {
		renderEntry();

		expect(await screen.findByText("病史采集工作区")).toBeInTheDocument();
		expect(screen.queryByText("问卷加载失败")).not.toBeInTheDocument();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});
