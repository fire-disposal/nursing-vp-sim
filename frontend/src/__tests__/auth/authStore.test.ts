import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogin = vi.fn();
const mockGetMe = vi.fn();
const mockLogout = vi.fn().mockResolvedValue(undefined);

vi.mock("@/api/api-client", () => ({
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

	it("initializes user from localStorage", async () => {
		const mockUser = {
			user_id: 1,
			role: "student" as const,
			display_name: "Test",
		};
		localStorage.setItem(
			"nursing-auth",
			JSON.stringify({
				state: { user: mockUser, token: "stored-token", permissions: [] },
				version: 1,
			}),
		);

		const { default: useAuthStore } = await import("@/stores/authStore");
		const state = useAuthStore.getState();
		expect(state.user).toEqual(mockUser);
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
			user_id: 2,
			username: "Student1",
			role: "student",
			display_name: "Student1",
			role_display_name: "student",
			gender: null,
			avatar: null,
			school_id: undefined,
			school_name: undefined,
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
});
