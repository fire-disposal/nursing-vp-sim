import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
	api: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

import { api } from "@/api/client";
import { getEmotionEvents } from "@/api/training";

const mockGet = vi.mocked(api.get);

beforeEach(() => {
	mockGet.mockReset();
	mockGet.mockResolvedValue({ data: { events: [] } });
});

describe("getEmotionEvents 请求路径", () => {
	it("走 /training/records/{id}/emotion-events（后端实际路由）", async () => {
		await getEmotionEvents(42);
		expect(mockGet.mock.calls[0][0]).toBe("/training/records/42/emotion-events");
	});

	it("与记录详情接口同前缀，避免漏段导致的 404 静默", async () => {
		await getEmotionEvents("rec-7");
		expect(mockGet.mock.calls[0][0]).toMatch(/^\/training\/records\/rec-7\//);
	});
});
