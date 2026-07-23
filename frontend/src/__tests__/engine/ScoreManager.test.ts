import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScoreManager } from "@/engine/ScoreManager";

vi.mock("@/api/client", () => ({
	api: {
		get: vi.fn(),
		post: vi.fn(),
	},
}));

vi.mock("@/api/training", () => ({
	retryScoring: vi.fn(),
}));

import { api } from "@/api/client";
import { retryScoring } from "@/api/training";

const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockPost = api.post as ReturnType<typeof vi.fn>;
const mockRetry = retryScoring as ReturnType<typeof vi.fn>;

describe("ScoreManager 相位防回退守卫", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockGet.mockReset();
		mockPost.mockReset();
		mockRetry.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("WS 推送：相位推进后拒绝回退事件，同相位拒绝百分比下降", () => {
		const m = new ScoreManager(1);
		m.onProgress({ record_id: 1, stage: "scoring", percent: 30, message: "s" });
		expect(m.progress.phase).toBe("scoring");
		expect(m.progress.percentage).toBe(30);

		m.onProgress({ record_id: 1, stage: "feedback", percent: 70, message: "f" });
		expect(m.progress.phase).toBe("feedback");

		// 乱序到达的旧相位事件 → 拒绝
		m.onProgress({ record_id: 1, stage: "scoring", percent: 45, message: "stale" });
		expect(m.progress.phase).toBe("feedback");
		expect(m.progress.percentage).toBe(70);

		// 同相位百分比下降 → 拒绝
		m.onProgress({ record_id: 1, stage: "feedback", percent: 40, message: "lower" });
		expect(m.progress.percentage).toBe(70);

		// 同相位百分比上升 → 接受
		m.onProgress({ record_id: 1, stage: "feedback", percent: 80, message: "higher" });
		expect(m.progress.percentage).toBe(80);
		m.dispose();
	});

	it("WS 推送：跨相位 thought 始终合并（scoring/feedback 并行）", () => {
		const m = new ScoreManager(1);
		m.onProgress({ record_id: 1, stage: "feedback", percent: 70, message: "f", thought: '{"strengths":[]}' });
		// scoring 阶段的 thought 迟到 → thought 合并但相位不回退
		m.onProgress({ record_id: 1, stage: "scoring", percent: 40, message: "s", thought: '{"detail_scores":{}}' });
		expect(m.progress.phase).toBe("feedback");
		expect(m.progress.score_thought).toBe('{"detail_scores":{}}');
		expect(m.progress.feedback_thought).toBe('{"strengths":[]}');
		m.dispose();
	});

	it("轮询：不覆盖 WS 已推进的相位", async () => {
		mockPost.mockResolvedValue({});
		// 后端轮询返回的进度落后于 WS 推送
		mockGet.mockResolvedValue({
			data: {
				scoring_status: "processing",
				progress: { phase: "scoring", percentage: 30, message: "评分中" },
			},
		});

		const m = new ScoreManager(1);
		await m.end();
		await vi.advanceTimersByTimeAsync(0);
		expect(m.progress.phase).toBe("scoring");

		// WS 推进到 feedback
		m.onProgress({ record_id: 1, stage: "feedback", percent: 70, message: "f" });
		expect(m.progress.phase).toBe("feedback");

		// 下一轮轮询返回落后的 scoring → 不得回退
		await vi.advanceTimersByTimeAsync(1500);
		expect(m.progress.phase).toBe("feedback");
		expect(m.progress.percentage).toBe(70);
		m.dispose();
	});

	it("轮询：无后端进度时假进度不降级 WS 已推进的相位", async () => {
		mockPost.mockResolvedValue({});
		mockGet.mockResolvedValue({ data: { scoring_status: "processing" } });

		const m = new ScoreManager(1);
		await m.end();
		await vi.advanceTimersByTimeAsync(0);

		m.onProgress({ record_id: 1, stage: "feedback", percent: 70, message: "f" });
		await vi.advanceTimersByTimeAsync(1500);

		// 假进度不得把 feedback 降级为 processing
		expect(m.progress.phase).toBe("feedback");
		expect(m.progress.percentage).toBeGreaterThanOrEqual(70);
		m.dispose();
	});

	it("retry()：重新触发评分并重启轮询", async () => {
		mockPost.mockResolvedValue({});
		mockGet.mockResolvedValue({
			data: { scoring_status: "failed", scoring_error: "LLM 超时" },
		});

		const m = new ScoreManager(1);
		await m.end();
		await vi.advanceTimersByTimeAsync(0);
		expect(m.progress.phase).toBe("failed");

		mockRetry.mockResolvedValue({});
		mockGet.mockResolvedValue({
			data: {
				scoring_status: "processing",
				progress: { phase: "scoring", percentage: 25, message: "评分中" },
			},
		});

		await m.retry();
		expect(mockRetry).toHaveBeenCalledWith(1);
		// retry 立即重启轮询（mock 的 api.get 同步微任务返回，相位可能已推进）
		expect(m.polling).toBe(true);

		await vi.advanceTimersByTimeAsync(1500);
		expect(m.progress.phase).toBe("scoring");
		expect(m.progress.percentage).toBe(25);
		m.dispose();
	});
});
