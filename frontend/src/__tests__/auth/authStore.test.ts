import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogin = vi.fn();
const mockGetMe = vi.fn();
const mockLogout = vi.fn().mockResolvedValue(undefined);

vi.mock("@/api", () => ({
	login: mockLogin,
	getMe: mockGetMe,
	logout: mockLogout,
	api: {
		interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
	},
}));

describe("authStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		localStorage.clear();
	});

	it("initializes with null user and token when localStorage is empty", async () => {
		const { default: useAuthStore } = await import("@/stores/authStore");
		const state = useAuthStore.getState();
		expect(state.user).toBeNull();
		expect(state.token).toBeNull();
	});

	it("migrates a v1 persisted user to the UserBrief id field", async () => {
		localStorage.setItem(
			"nursing-auth",
			JSON.stringify({
				state: {
					user: { user_id: 1, role: "student", display_name: "Test" },
					token: "stored-token",
					permissions: [],
				},
				version: 1,
			}),
		);

		const { default: useAuthStore } = await import("@/stores/authStore");
		const state = useAuthStore.getState();
		expect(state.user).toEqual({ id: 1, role: "student", display_name: "Test" });
		expect(state.token).toBe("stored-token");
	});

	it("handles corrupted localStorage user data gracefully", async () => {
		localStorage.setItem("nursing-auth", "not-json");

		const { default: useAuthStore } = await import("@/stores/authStore");
		const state = useAuthStore.getState();
		expect(state.user).toBeNull();
	});

	it("login stores token and user in localStorage", async () => {
		mockLogin.mockResolvedValue({
			data: {
				access_token: "new-token",
				role: "student",
				display_name: "Student1",
				user_id: 2,
			},
		});

		const { default: useAuthStore } = await import("@/stores/authStore");
		const user = await useAuthStore.getState().login("user", "pass");

		expect(user).toEqual({
			id: 2,
			username: "Student1",
			role: "student",
			display_name: "Student1",
			role_display_name: "student",
			student_id: null,
			gender: null,
			avatar: null,
			memberships: [],
			// 登录成功即启用态（后端在鉴权层拒绝停用账号登录，见 auth.service）
			is_active: true,
		});
		const persisted = JSON.parse(
			localStorage.getItem("nursing-auth") || "{}",
		);
		expect(persisted.state?.token).toBe("new-token");
		expect(persisted.state?.user?.role).toBe("student");
	});

	it("refreshUser updates user from getMe response", async () => {
		localStorage.setItem("token", "valid-token");
		localStorage.setItem(
			"user",
			JSON.stringify({ user_id: 1, role: "student", display_name: "Old" }),
		);

		mockGetMe.mockResolvedValue({
			data: { id: 1, role: "student", display_name: "Updated", username: "u1" },
		});

		const { default: useAuthStore } = await import("@/stores/authStore");
		await useAuthStore.getState().refreshUser();

		const state = useAuthStore.getState();
		expect(state.user?.display_name).toBe("Updated");
	});

	it("logout clears state and localStorage", async () => {
		localStorage.setItem(
			"nursing-auth",
			JSON.stringify({
				state: {
					user: { user_id: 1, role: "student", display_name: "X" },
					token: "t",
					permissions: [],
				},
				version: 1,
			}),
		);

		const { default: useAuthStore } = await import("@/stores/authStore");
		useAuthStore.getState().logout();

		const state = useAuthStore.getState();
		expect(state.user).toBeNull();
		expect(state.token).toBeNull();
		const persisted = JSON.parse(
			localStorage.getItem("nursing-auth") || "{}",
		);
		expect(persisted.state?.token).toBeNull();
	});

	it("refreshUser calls logout on failure", async () => {
		localStorage.setItem("token", "t");
		mockGetMe.mockRejectedValue(new Error("401"));

		const { default: useAuthStore } = await import("@/stores/authStore");
		await useAuthStore.getState().refreshUser();

		const state = useAuthStore.getState();
		expect(state.user).toBeNull();
		expect(state.token).toBeNull();
	});

	// ── 冷启动会话恢复时的权限 revalidation ────────────────────────────────
	// 持久化里的 `permissions` 是上次会话的快照（可能早于最近一次授权变更），
	// 恢复会话必须用 `/auth/me` 现取结果覆盖，否则路由门禁用旧快照把有权用户挡在 403 页。
	const STALE_PERMISSIONS = ["training_access", "qa_access"];

	function seedPersistedSession() {
		localStorage.setItem(
			"nursing-auth",
			JSON.stringify({
				state: {
					user: { id: 7, username: "学生1", role: "student", display_name: "学生1" },
					token: "persisted-token",
					permissions: STALE_PERMISSIONS,
				},
				version: 2,
			}),
		);
	}

	it("冷启动用 /auth/me 覆盖陈旧权限快照（新授予的键必须生效）", async () => {
		seedPersistedSession();
		mockGetMe.mockResolvedValue({
			data: {
				id: 7,
				username: "学生1",
				role: "student",
				display_name: "学生1",
				permissions: ["qa_access", "scenario_training", "training_access"],
			},
		});

		const { default: useAuthStore } = await import("@/stores/authStore");
		await vi.waitFor(() =>
			expect(useAuthStore.getState().permissions).toContain("scenario_training"),
		);
		expect(useAuthStore.getState().sessionReady).toBe(true);
		expect(useAuthStore.getState().token).toBe("persisted-token");
	});

	it("冷启动 revalidation 遇到 401 时清理会话（token 已失效）", async () => {
		seedPersistedSession();
		mockGetMe.mockRejectedValue({ response: { status: 401 } });

		const { default: useAuthStore } = await import("@/stores/authStore");
		await vi.waitFor(() => expect(useAuthStore.getState().token).toBeNull());

		expect(useAuthStore.getState().user).toBeNull();
		expect(useAuthStore.getState().sessionReady).toBe(true);
		const persisted = JSON.parse(localStorage.getItem("nursing-auth") || "{}");
		expect(persisted.state?.token).toBeNull();
	});

	it("冷启动 revalidation 遇到 5xx 时保留会话与旧权限，不误踢下线", async () => {
		seedPersistedSession();
		mockGetMe.mockRejectedValue({ response: { status: 503 } });

		const { default: useAuthStore } = await import("@/stores/authStore");
		await vi.waitFor(() => expect(useAuthStore.getState().sessionReady).toBe(true));

		// revalidation 必须真的发过（否则本用例会因初始值而假绿）
		expect(mockGetMe).toHaveBeenCalledTimes(1);
		expect(useAuthStore.getState().token).toBe("persisted-token");
		expect(useAuthStore.getState().user?.id).toBe(7);
		expect(useAuthStore.getState().permissions).toEqual(STALE_PERMISSIONS);
	});

	it("冷启动 revalidation 断网时保留会话，不误踢下线", async () => {
		seedPersistedSession();
		mockGetMe.mockRejectedValue(new Error("Network Error"));

		const { default: useAuthStore } = await import("@/stores/authStore");
		await vi.waitFor(() => expect(useAuthStore.getState().sessionReady).toBe(true));

		expect(mockGetMe).toHaveBeenCalledTimes(1);
		expect(useAuthStore.getState().token).toBe("persisted-token");
		expect(useAuthStore.getState().user?.id).toBe(7);
	});

	it("/auth/me 返回空数组时按服务端为准清空权限（撤销授权也要生效）", async () => {
		seedPersistedSession();
		mockGetMe.mockResolvedValue({
			data: { id: 7, username: "学生1", role: "student", display_name: "学生1", permissions: [] },
		});

		const { default: useAuthStore } = await import("@/stores/authStore");
		await vi.waitFor(() => expect(useAuthStore.getState().sessionReady).toBe(true));

		expect(useAuthStore.getState().permissions).toEqual([]);
	});
});
