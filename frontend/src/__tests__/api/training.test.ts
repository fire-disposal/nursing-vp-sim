import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
	api: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

import { api } from "@/api/client";
import { getEmotionEvents, pauseTrainingOnHide } from "@/api/training";
import useAuthStore from "@/stores/authStore";

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

describe("pauseTrainingOnHide（离页暂停必须带 Authorization）", () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		fetchMock.mockReset();
		useAuthStore.setState({ token: "token-abc" });
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		useAuthStore.setState({ token: null });
	});

	it("用 keepalive + Bearer 头 POST 暂停接口（sendBeacon 无法携带请求头，必然被服务端拒绝）", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ message: "训练已暂停" }),
		});

		await expect(pauseTrainingOnHide(42)).resolves.toBe("训练已暂停");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/training/records/42/pause");
		expect(init.method).toBe("POST");
		expect(init.keepalive).toBe(true);
		expect(init.headers.Authorization).toBe("Bearer token-abc");
	});

	it("问卷暂停走同一认证通道（?questionnaire=true）", async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: "问卷作答期间计时已暂停" }) });

		await pauseTrainingOnHide(7, { questionnaire: true });

		expect(fetchMock.mock.calls[0][0]).toBe("/api/training/records/7/pause?questionnaire=true");
	});

	it("服务端拒绝时抛错（调用方据此不宣称已暂停）", async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

		await expect(pauseTrainingOnHide(42)).rejects.toThrow("401");
	});
});
