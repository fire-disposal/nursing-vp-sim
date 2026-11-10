import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/api/query-client";
import useAuthStore from "@/stores/authStore";

vi.mock("@/api", () => ({
	login: vi.fn(),
	logout: vi.fn().mockResolvedValue(undefined),
	refreshToken: vi.fn(),
	getMe: vi.fn(),
}));

describe("会话边界清理查询缓存", () => {
	beforeEach(() => {
		queryClient.clear();
		useAuthStore.setState({ user: null, token: null, permissions: [] });
	});

	it("退出登录后不保留上一账号的查询数据", () => {
		queryClient.setQueryData(["admin", "records"], [{ patient: "上一账号可见的数据" }]);
		useAuthStore.getState().logout();
		expect(queryClient.getQueryData(["admin", "records"])).toBeUndefined();
	});
});
