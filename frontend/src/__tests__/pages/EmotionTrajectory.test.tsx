import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@/__tests__/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmotionTrajectory } from "@/pages/record-detail/EmotionTrajectory";

const apiMock = vi.hoisted(() => ({
	getEmotionEvents: vi.fn(),
}));

vi.mock("@/api/training", () => ({
	getEmotionEvents: apiMock.getEmotionEvents,
}));

function renderTrajectory() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<EmotionTrajectory recordId="7" />
		</QueryClientProvider>,
	);
}

afterEach(() => {
	vi.clearAllMocks();
});

describe("EmotionTrajectory", () => {
	it("请求失败时给出可见提示，不再静默空白", async () => {
		apiMock.getEmotionEvents.mockRejectedValue(new Error("404"));
		renderTrajectory();
		expect(await screen.findByText(/情绪轨迹加载失败/)).toBeInTheDocument();
	});

	it("有事件时渲染曲线卡片与事件数", async () => {
		apiMock.getEmotionEvents.mockResolvedValue([
			{
				event_type: "empathy",
				evidence: "我理解您很担心",
				after_state: { trust: 62, anxiety: 40, irritation: 12, cooperation: 70 },
			},
		]);
		renderTrajectory();
		expect(await screen.findByText(/情绪轨迹（1 个事件）/)).toBeInTheDocument();
	});

	it("无事件时不占位", async () => {
		apiMock.getEmotionEvents.mockResolvedValue([]);
		renderTrajectory();
		await waitFor(() => expect(apiMock.getEmotionEvents).toHaveBeenCalled());
		expect(screen.queryByText(/情绪轨迹/)).not.toBeInTheDocument();
		expect(screen.queryByText(/加载失败/)).not.toBeInTheDocument();
	});
});
