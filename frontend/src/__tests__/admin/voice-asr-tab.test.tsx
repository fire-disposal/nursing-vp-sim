import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import type { AsrStatusResponse, VoiceConfigResponse, VoiceUsageResponse } from "@/api/admin/voice-cost";
import CostManagementPage from "@/pages/ops/CostManagementPage";

// 只替换网络边界与体积大的无关页签；ASR 页签本身跑真实组件。
const fetchVoiceUsage = vi.fn();
const fetchVoiceConfig = vi.fn();
const updateVoiceConfig = vi.fn();
const testAsrConnection = vi.fn();

vi.mock("@/api/admin/voice-cost", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/api/admin/voice-cost")>();
	return {
		...actual,
		fetchVoiceUsage: (...args: unknown[]) => fetchVoiceUsage(...args),
		fetchVoiceConfig: (...args: unknown[]) => fetchVoiceConfig(...args),
		updateVoiceConfig: (...args: unknown[]) => updateVoiceConfig(...args),
		testAsrConnection: (...args: unknown[]) => testAsrConnection(...args),
	};
});

vi.mock("@/components/admin/monitor/MonitorTab", () => ({ default: () => <div>monitor-tab</div> }));
vi.mock("@/pages/ops/cost/CostDashboard", () => ({ default: () => <div>cost-dashboard</div> }));
vi.mock("@/pages/ops/cost/CostExportTab", () => ({ default: () => <div>cost-export</div> }));

const usage: VoiceUsageResponse = {
	tts_today: { calls_total: 0, calls_success: 0, calls_fallback: 0, calls_error: 0, total_chars: 0, total_latency_ms: 0, cost_estimated: 0 },
	tts_month: { calls_total: 0, calls_success: 0, calls_fallback: 0, calls_error: 0, total_chars: 0, total_latency_ms: 0, cost_estimated: 0 },
	asr_today: { calls_total: 40, calls_success: 38, calls_fallback: 0, calls_error: 2, total_chars: 0, total_latency_ms: 0, cost_estimated: 1.5 },
	asr_month: { calls_total: 900, calls_success: 880, calls_fallback: 0, calls_error: 20, total_chars: 0, total_latency_ms: 0, cost_estimated: 33.25 },
	monthly_budget: 200,
	monthly_used: 12,
};

const config: VoiceConfigResponse = {
	id: 7,
	provider: "volcengine",
	api_key_masked: "********tts1",
	api_key_suffix: "tts1",
	asr_api_key_masked: "********asr9",
	asr_api_key_suffix: "asr9",
	tts_resource_id: "seed-tts-2.0",
	tts_speaker: "zh_female_vv_uranus_bigtts",
	tts_model: "seed-tts-2.0-standard",
	tts_sample_rate: 24000,
	tts_format: "mp3",
	tts_timeout: 8,
	monthly_budget: 200,
	is_active: true,
	speaker_library: null,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

const onlineStatus: AsrStatusResponse = {
	provider: "volcengine",
	asr_online: true,
	last_error: null,
	last_error_at: null,
	resource_id: "volc.seedasr.sauc.duration",
};

function renderAt(url: string, element: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[url]}>
				<Routes>
					<Route path="/ops/cost" element={element} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	fetchVoiceUsage.mockResolvedValue({ data: usage });
	fetchVoiceConfig.mockResolvedValue(config);
	testAsrConnection.mockResolvedValue(onlineStatus);
	updateVoiceConfig.mockImplementation((payload: Record<string, unknown>) =>
		Promise.resolve({ ...config, asr_api_key_masked: "********new9", ...payload }),
	);
});

describe("成本管理 · ASR 页签", () => {
	it("页签可从地址栏直达，页头与页签都出现 ASR", async () => {
		renderAt("/ops/cost?tab=asr", <CostManagementPage />);

		expect(screen.getByRole("heading", { name: "成本管理" })).toBeInTheDocument();
		expect(screen.getByText("ASR 管理")).toBeInTheDocument();
		expect(await screen.findByText("ASR 使用统计")).toBeInTheDocument();
	});

	it("渲染 ASR 今日/本月统计，且不与 TTS 混算", async () => {
		renderAt("/ops/cost?tab=asr", <CostManagementPage />);

		expect(await screen.findByText("¥1.50")).toBeInTheDocument();
		expect(screen.getByText("¥33.25")).toBeInTheDocument();
		expect(screen.getByText("今日成功率")).toBeInTheDocument();
		expect(screen.getByText("95.0%")).toBeInTheDocument();

		// 使用表两行：今日 40 次调用 / 本月 900 次
		const todayRow = await screen.findByRole("row", { name: /今日/ });
		expect(todayRow).toHaveTextContent("40");
		expect(todayRow).toHaveTextContent("38");
		expect(todayRow).toHaveTextContent("2");
		// 表头用「本月」不重名：精确到首列单元格
		const monthRow = screen.getAllByRole("row").find((r) => r.textContent?.startsWith("本月"));
		expect(monthRow).toBeDefined();
		expect(monthRow).toHaveTextContent("900");

		// TTS 的预算卡不下沉到 ASR 页签
		expect(screen.queryByText("月度预算")).not.toBeInTheDocument();
	});

	it("配置卡展示独立 ASR Key 掩码与资源单价", async () => {
		renderAt("/ops/cost?tab=asr", <CostManagementPage />);

		const keyInput = (await screen.findByLabelText("ASR API Key")) as HTMLInputElement;
		// 锁定态：默认不可编辑、只显示服务端掩码
		expect(keyInput).toBeDisabled();
		expect(keyInput).toHaveAttribute("placeholder", "********asr9");
		expect(screen.getByText("流式 ASR 2.0 小时版")).toBeInTheDocument();
		expect(screen.getByText("计费 1 元/小时")).toBeInTheDocument();
		expect(screen.getByText("测试连接只建立会话并发送配置帧，不发送音频")).toBeInTheDocument();
	});

	it("保存只提交 asr_api_key，不覆盖 TTS 字段", async () => {
		const user = userEvent.setup();
		renderAt("/ops/cost?tab=asr", <CostManagementPage />);

		await screen.findByText("ASR 使用统计");
		await screen.findByLabelText("ASR API Key");
		await user.click(screen.getByRole("button", { name: "编辑" }));
		const keyInput = screen.getByLabelText("ASR API Key");
		expect(keyInput).not.toBeDisabled();
		await user.type(keyInput, "sk-asr-new-key");
		await user.click(screen.getByRole("button", { name: /保存 ASR Key/ }));

		await waitFor(() => expect(updateVoiceConfig).toHaveBeenCalledTimes(1));
		expect(updateVoiceConfig).toHaveBeenCalledWith({ asr_api_key: "sk-asr-new-key" });
	});

	it("手动测试连接走到 test-asr，并显示在线状态", async () => {
		const user = userEvent.setup();
		renderAt("/ops/cost?tab=asr", <CostManagementPage />);

		await waitFor(() => expect(testAsrConnection).toHaveBeenCalled());
		expect(await screen.findByText("在线")).toBeInTheDocument();

		testAsrConnection.mockResolvedValue({
			...onlineStatus,
			asr_online: false,
			last_error: "ASR 上游拒绝连接（HTTP 401）",
			last_error_at: "2026-11-17T08:00:00Z",
		});
		await user.click(screen.getByRole("button", { name: /测试连接/ }));

		expect(await screen.findByText("离线")).toBeInTheDocument();
		expect(screen.getByText("ASR API Key 无效或已过期")).toBeInTheDocument();
		expect(testAsrConnection).toHaveBeenCalledTimes(2);
	});

	it("ASR 页签不消费 TTS 统计：免费用量表显示 0 而不是 TTS 数值", async () => {
		fetchVoiceUsage.mockResolvedValue({
			data: {
				...usage,
				tts_today: { ...usage.tts_today, calls_total: 999 },
				asr_today: { ...usage.asr_today, calls_total: 0, cost_estimated: 0 },
			},
		});
		renderAt("/ops/cost?tab=asr", <CostManagementPage />);

		await screen.findByText("ASR 使用统计");
		expect(screen.getAllByText("¥0.00")).toHaveLength(2); // 今日费用卡 + 今日用量费用
		expect(screen.queryByText("999")).not.toBeInTheDocument();
		expect(screen.queryByText("¥1.50")).not.toBeInTheDocument();
	});
});
