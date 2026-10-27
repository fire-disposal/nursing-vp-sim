import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@/__tests__/render";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeManifest } from "@/__tests__/fixtures/manifest";
import TrainingEntry from "@/pages/TrainingEntry";

/**
 * 已结束的会话不得继续渲染训练工作区。
 *
 * 现场（2026-10-27）：会话在别处结束（他端结束 / 超时结算 / 患者中止）后，训练页仍渲染成
 * 「可训练」的样子——顶栏「结束训练」能打开确认框，但服务端 manifest 给出
 * `SESSION_NOT_ACTIVE` 阻塞，确认键永久禁用。学生因此既拿不到评分，也找不到出口。
 * 结果与评分进度只有记录详情页一份，所以会话一旦结束就应落回 `/record/{id}`。
 */
const apiMock = vi.hoisted(() => ({
	getRecordDetail: vi.fn(),
	resumeTraining: vi.fn(),
	pauseTraining: vi.fn(),
	pauseTrainingOnHide: vi.fn(),
	checkQuestionnaire: vi.fn(),
	submitQuestionnaire: vi.fn(),
}));

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

vi.mock("@/components/training/scenes/scene-registry", () => ({
	TRAINING_SCENES: {
		history_taking: () => <div>病史采集工作区</div>,
	},
}));

function record(status: string) {
	return {
		id: 7,
		case_id: 1,
		mode: "guided",
		status,
		scoring_status: null,
		manifest: makeManifest({
			session: { session_id: 7, status, revision: 1 },
			completion: {
				eligible: false,
				conditions: [],
				blockers: [
					{ code: "SESSION_NOT_ACTIVE", message: "训练已结束，无法再次提交完成", target: null },
				],
			},
			actions: [{ id: "complete_session", label: "结束训练", enabled: false }],
		}),
		messages: [],
	};
}

function renderEntry() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={["/training/7"]}>
				<Routes>
					<Route path="/training/:recordId" element={<TrainingEntry />} />
					<Route path="/record/:id" element={<div>记录详情页</div>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	apiMock.getRecordDetail.mockResolvedValue({ data: record("completed") });
	apiMock.resumeTraining.mockResolvedValue({ data: {} });
	apiMock.pauseTraining.mockResolvedValue({ data: {} });
	apiMock.pauseTrainingOnHide.mockResolvedValue({ data: {} });
	apiMock.checkQuestionnaire.mockResolvedValue({
		data: { has_pending: false, is_required: false, trigger_event: "before_training" },
	});
	apiMock.submitQuestionnaire.mockResolvedValue({ data: {} });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("训练入口 · 会话已结束", () => {
	it("已完成的记录落到记录详情页，不再渲染死路的工作区", async () => {
		renderEntry();

		expect(await screen.findByText("记录详情页")).toBeInTheDocument();
		expect(screen.queryByText("病史采集工作区")).not.toBeInTheDocument();
	});

	it("进行中的记录照常进入工作区", async () => {
		apiMock.getRecordDetail.mockResolvedValue({ data: record("in_progress") });

		renderEntry();

		expect(await screen.findByText("病史采集工作区")).toBeInTheDocument();
		expect(screen.queryByText("记录详情页")).not.toBeInTheDocument();
	});
});
