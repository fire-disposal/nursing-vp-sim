import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProtectedRoute from "@/components/ProtectedRoute";
import RequirePermission from "@/components/RequirePermission";
import useAuthStore from "@/stores/authStore";
import { render } from "../render";

/**
 * 冷启动（带持久化 token 恢复会话）必须先 revalidate 权限再判定路由门禁。
 *
 * 生产缺陷（2026-09-28）：`localStorage["nursing-auth"].state.permissions` 是上次会话的旧快照，
 * 部署后新授予的 `scenario_training` 不在里面；`/auth/me` 返回的现取权限才是对的，
 * 但前端恢复会话时从不刷新 → 有权学生被 `RequirePermission` 的旧快照挡在 403 页。
 *
 * 这里不做 `vi.resetModules()`：组件与 store 必须是**同一个实例**，否则测试改的是另一份 store。
 * 恢复会话用 `persist.rehydrate()` 触发（与模块首次加载走同一条 onRehydrateStorage 路径）。
 */
vi.mock("@/hooks/useScoringNotifications", () => ({
	// 评分推送订阅与本用例无关（会开 WS），这里只关心门禁渲染顺序。
	useScoringNotifications: () => {},
}));

const mocks = vi.hoisted(() => ({
	getMe: vi.fn(),
	login: vi.fn(),
	logout: vi.fn().mockResolvedValue(undefined),
	refreshToken: vi.fn(),
}));

vi.mock("@/api", () => ({
	login: mocks.login,
	getMe: mocks.getMe,
	logout: mocks.logout,
	refreshToken: mocks.refreshToken,
	api: {
		interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
	},
}));

/** 持久化快照里的学生：缺部署后新授予的 `scenario_training`。 */
const STALE_PERMISSIONS = ["training_access", "qa_access"];
const SERVER_PERMISSIONS = ["qa_access", "scenario_training", "training_access"];

function seedPersistedSession() {
	localStorage.setItem(
		"nursing-auth",
		JSON.stringify({
			state: {
				user: {
					id: 7,
					username: "学生1",
					role: "student",
					role_display_name: "学生",
					display_name: "学生1",
					student_id: null,
					is_active: true,
					gender: null,
					avatar: null,
					memberships: [],
				},
				token: "persisted-token",
				permissions: STALE_PERMISSIONS,
			},
			version: 2,
		}),
	);
}

function renderScenarioRoute() {
	return render(
		<MemoryRouter initialEntries={["/scenario"]}>
			<Routes>
				<Route element={<ProtectedRoute />}>
					<Route
						path="/scenario"
						element={
							<RequirePermission permission="scenario_training">
								<div>受保护内容</div>
							</RequirePermission>
						}
					/>
				</Route>
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	useAuthStore.setState({
		user: null,
		token: null,
		permissions: [],
		sessionReady: true,
	});
});

describe("冷启动会话的权限 revalidation", () => {
	it("revalidation 落地前不渲染 403；拿到 /auth/me 的新权限键后放行", async () => {
		// 需要"挂起中的 /auth/me"来观察等待窗口；`Promise.withResolvers` 要 ES2024 lib，
		// 本仓 tsconfig target ES2022 未提供，故显式 deferred。
		let resolveMe: (value: unknown) => void = () => {};
		const mePromise = new Promise<unknown>((resolve) => {
			resolveMe = resolve;
		});
		mocks.getMe.mockReturnValue(mePromise);

		seedPersistedSession();
		await useAuthStore.persist.rehydrate();
		expect(useAuthStore.getState().token).toBe("persisted-token");
		expect(useAuthStore.getState().sessionReady).toBe(false);

		renderScenarioRoute();

		// 旧快照里没有 scenario_training，但门禁必须先等 revalidation —— 既不放行也不拒绝
		expect(screen.queryByText("没有访问权限")).toBeNull();
		expect(screen.queryByText("受保护内容")).toBeNull();

		resolveMe({
			data: {
				id: 7,
				username: "学生1",
				role: "student",
				role_display_name: "学生",
				display_name: "学生1",
				student_id: null,
				is_active: true,
				memberships: [],
				permissions: SERVER_PERMISSIONS,
			},
		});

		expect(await screen.findByText("受保护内容")).toBeTruthy();
		expect(screen.queryByText("没有访问权限")).toBeNull();
		expect(useAuthStore.getState().permissions).toEqual(SERVER_PERMISSIONS);
	});

	it("revalidation 遇网络/5xx 时结束等待、保留会话（门禁不空转）", async () => {
		mocks.getMe.mockRejectedValue({ response: { status: 503 } });

		seedPersistedSession();
		await useAuthStore.persist.rehydrate();

		renderScenarioRoute();

		// 拿不到现取权限 → 退回旧快照判定（有权用户此时看到 403 也是"服务端联系不上"的既定兜底），
		// 关键是不能一直卡在等待态。
		expect(await screen.findByText("没有访问权限")).toBeTruthy();
		await waitFor(() =>
			expect(useAuthStore.getState().sessionReady).toBe(true),
		);
		expect(mocks.getMe).toHaveBeenCalledTimes(1);
		expect(useAuthStore.getState().token).toBe("persisted-token");
	});
});
