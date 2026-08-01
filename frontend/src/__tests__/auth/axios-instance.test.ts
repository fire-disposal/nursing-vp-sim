import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAxiosCreate = vi.fn(() => ({
	interceptors: {
		request: { use: vi.fn() },
		response: { use: vi.fn() },
	},
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
}));

vi.mock("axios", () => ({
	default: { create: mockAxiosCreate },
}));

const mockAuthState = { token: null as string | null };
vi.mock("@/stores/authStore", () => ({
	default: {
		getState: () => ({ token: mockAuthState.token }),
	},
}));

describe("API axios instance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		localStorage.clear();
		mockAuthState.token = null;
	});

	it("creates axios instance with /api baseURL and 30s timeout", async () => {
		await import("@/api/client");
		expect(mockAxiosCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "/api",
				timeout: 30000, // SSE 流式不走 axios，30s 为普通请求超时
			}),
		);
	});

	it("request interceptor adds Bearer token from localStorage", async () => {
		mockAuthState.token = "test-token-abc";

		let capturedConfig: Record<string, unknown> | null = null;
		mockAxiosCreate.mockReturnValue({
			interceptors: {
				request: {
					use: vi.fn(
						(fn: (c: Record<string, unknown>) => Record<string, unknown>) => {
							capturedConfig = fn({ headers: {} });
						},
					),
				},
				response: { use: vi.fn() },
			},
			get: vi.fn(),
			post: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
		});

		await import("@/api/client");
		expect(capturedConfig).not.toBeNull();
		expect(capturedConfig!.headers).toEqual(
			expect.objectContaining({ Authorization: "Bearer test-token-abc" }),
		);
	});

	it("request interceptor does not add header when no token", async () => {
		let capturedConfig: Record<string, unknown> | null = null;
		mockAxiosCreate.mockReturnValue({
			interceptors: {
				request: {
					use: vi.fn(
						(fn: (c: Record<string, unknown>) => Record<string, unknown>) => {
							capturedConfig = fn({ headers: {} });
						},
					),
				},
				response: { use: vi.fn() },
			},
			get: vi.fn(),
			post: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
		});

		await import("@/api/client");
		expect(capturedConfig).not.toBeNull();
		expect(capturedConfig!.headers).toEqual({});
	});
});
