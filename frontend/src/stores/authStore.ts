import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	login as apiLogin,
	logout as apiLogout,
	refreshToken as apiRefreshToken,
	getMe,
} from "@/api";
import { dispatchForceLogout } from "@/events";
import { usePersonaStore } from "@/stores/personaStore";
import { useSchoolScopeStore } from "@/stores/schoolScopeStore";
import type { AuthState, User } from "../types/store";

/** 把服务端回话里的视角写进 personaStore（登录 / 刷新 / `/auth/me` 三处共用）。 */
function syncPersonas(data: { personas?: string[]; active_persona?: string | null }): void {
	if (!Array.isArray(data.personas)) return;
	usePersonaStore.getState().setAvailable(data.personas, data.active_persona ?? null);
}

/** 把服务端的「当前生效院校」同步到本地快照（顶栏/主题/院校组件都读它）。 */
function syncSchoolScope(data: {
	active_school_id?: number | null;
	school_id?: number | null;
	school_personas?: { school_id: number; school_name: string }[];
}): void {
	const active = data.active_school_id;
	if (active == null || active === data.school_id) return;
	const grant = (data.school_personas ?? []).find((item) => item.school_id === active);
	if (!grant) return;
	useSchoolScopeStore.getState().setSchool({
		id: grant.school_id,
		name: grant.school_name,
		themeColor: null,
		hasLogo: false,
		logoUpdatedAt: null,
	});
}

/** 取 HTTP 状态码（axios 错误的形状）；不是 axios 错误就返回 undefined。 */
function httpStatusOf(err: unknown): number | undefined {
	if (typeof err !== "object" || err === null || !("response" in err)) return undefined;
	const response = err.response;
	if (typeof response !== "object" || response === null || !("status" in response)) return undefined;
	return typeof response.status === "number" ? response.status : undefined;
}

interface ExtendedAuthState extends AuthState {
	permissions: string[];
	refreshAuth: () => Promise<boolean>;
	/**
	 * 会话是否已"落定"（权限不早于当前会话）。
	 * 冷启动带持久化 token 时为 `false`，直到 `revalidateSession()` 用 `/auth/me` 现取结果
	 * 覆盖完持久化快照；路由门禁在此前必须先等待，见 `components/ProtectedRoute.tsx`。
	 */
	sessionReady: boolean;
	revalidateSession: () => Promise<void>;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
export let isRefreshing = false;
export function setRefreshing(v: boolean) { isRefreshing = v; }
let isLoggingOut = false;

export function startRefreshTimer(): void {
	const token = useAuthStore.getState().token;
	if (!token) return;
	if (refreshTimer) clearInterval(refreshTimer);
	refreshTimer = setInterval(() => {
		if (isRefreshing) return;
		setRefreshing(true);
		useAuthStore.getState().refreshAuth().finally(() => {
			setRefreshing(false);
		});
	}, 24 * 60 * 60 * 1000);
}

export function stopRefreshTimer(): void {
	if (refreshTimer) {
		clearInterval(refreshTimer);
		refreshTimer = null;
	}
}

type PersistedState = Pick<ExtendedAuthState, "user" | "token" | "permissions">;

const useAuthStore = create<ExtendedAuthState>()(
	persist(
		(set, get) => ({
			user: null,
			token: null,
			permissions: [],
			// 默认"已落定"；带持久化 token 冷启动时由 revalidateSession() 同步置 false，
			// 结果落地（或失败）后回到 true。见 components/ProtectedRoute.tsx 的门禁。
			sessionReady: true,

			login: async (username: string, password: string): Promise<User> => {
				const { data } = await apiLogin(username, password);
				// 换人登录不能带走上一账号的院校作用域/视角偏好（与 logout 对齐；
				// 覆盖“会话过期后直接登录另一个账号、没走 logout”的路径）。
				useSchoolScopeStore.getState().setSchool(null);
				usePersonaStore.getState().clear();
				const user: User = {
					id: data.user_id,
					// 登录响应只有 display_name：用户名先用输入值，避免 /auth/me 失败时
					// 把「@显示名」当成账号名（随后 getMe 会用服务端权威值覆盖）。
					username: username,
					display_name: data.display_name,
					student_id: null,
					gender: data.gender ?? null,
					// 登录成功即账号为启用态（后端在鉴权层拒绝停用账号，见 auth.service）
					is_active: true,
					avatar: data.avatar ?? null,
					memberships: [],
					// 登录响应不含院校品牌字段：占位为 false，紧接着的 /auth/me 会补齐
					school_has_logo: false,
					// 视角身份：登录响应已带上授予集合与默认生效视角，`/auth/me` 再补齐一次
					personas: data.personas ?? [],
					active_persona: data.active_persona ?? null,
					active_school_id: null,
					school_personas: [],
					is_platform: data.is_platform ?? false,
				};
				set({ user, token: data.access_token, permissions: data.permissions });
				syncPersonas(data);

				startRefreshTimer();

				try {
					const { data: me } = await getMe();
					syncPersonas(me);
					const current = get().user;
					if (current) {
						set({
							user: {
								...current,
								// 登录响应只有 display_name，没有登录名/学号/院校品牌：不在这里补齐，
								// 用户会把「@显示名」当成账号名，院校管理员也看不到本校品牌。
								id: me.id ?? current.id,
								username: me.username || current.username,
								display_name: me.display_name || current.display_name,
								student_id: me.student_id ?? current.student_id ?? null,
								gender: me.gender ?? current.gender ?? null,
								avatar: me.avatar ?? current.avatar ?? null,
								is_active: me.is_active ?? current.is_active,
								is_platform: me.is_platform ?? current.is_platform,
								personas: me.personas ?? current.personas ?? [],
								active_persona: me.active_persona ?? current.active_persona ?? null,
								active_school_id: me.active_school_id ?? null,
								school_personas: me.school_personas ?? [],
								memberships: me.memberships ?? [],
								// 院校归属只存在于 /auth/me（登录响应没有）：漏合并会让院校管理员
								// 在壳里被显示成「平台」，等于告诉他"你是跨校的"
								school_id: me.school_id ?? null,
								school_name: me.school_name ?? null,
								school_theme_color: me.school_theme_color ?? null,
								school_has_logo: me.school_has_logo ?? false,
								school_logo_updated_at: me.school_logo_updated_at ?? null,
							},
							// 权限以 /auth/me 现取为准（返回数组即覆盖，空数组 = 真的没权限）；
							// 字段缺失才留用登录响应里的值。
							permissions: Array.isArray(me.permissions)
								? me.permissions
								: get().permissions,
						});
						// 服务端可能把默认院校定在附加院校（家院校没有授予）：顶栏必须跟着走，
						// 否则显示家院校、数据却来自另一所（X-School-Scope 为空时由服务端决定）。
						syncSchoolScope(me);
					}
				} catch {
					// ignore — 视角/院校字段由登录响应兜底，权限留给下一次 revalidateSession
				}

				return get().user!;
			},

			refreshAuth: async (): Promise<boolean> => {
				try {
					const { data } = await apiRefreshToken();
					set({ token: data.access_token, permissions: data.permissions });
					syncPersonas(data);
					return true;
			} catch (err: unknown) {
				const is401 = (
					err != null &&
					typeof err === "object" &&
					"response" in err &&
					(err as { response?: { status?: number } }).response?.status === 401
				);
				if (is401) {
					console.warn("[authStore] refreshAuth 401 — 清除会话");
					stopRefreshTimer();
					set({ user: null, token: null, permissions: [] });
					usePersonaStore.getState().clear();
				} else {
					console.warn("[authStore] refreshAuth 网络/服务端错误 — 保持现有会话", err);
				}
				return false;
			}
			},

			refreshUser: async (): Promise<void> => {
				try {
					const { data } = await getMe();
					syncPersonas(data);
					const current = get().user;
					const user: User = {
						id: data.id,
						username: data.username || current?.username || "",
						display_name: data.display_name,
						student_id: data.student_id ?? null,
						is_active: data.is_active ?? true,
						gender: data.gender ?? null,
						avatar: data.avatar ?? null,
						memberships: data.memberships ?? [],
						// 视角身份：授予集合 + 当前生效视角（`/auth/me` 现取，权威口径）
						personas: data.personas ?? [],
						active_persona: data.active_persona ?? null,
						active_school_id: data.active_school_id ?? null,
						school_personas: data.school_personas ?? [],
						is_platform: data.is_platform ?? false,
						school_id: data.school_id ?? null,
						school_name: data.school_name ?? null,
						school_theme_color: data.school_theme_color ?? null,
						school_has_logo: data.school_has_logo ?? false,
						school_logo_updated_at: data.school_logo_updated_at ?? null,
					};
					// 与登录路径一致：顺带刷新权限集合（/auth/me 现取，数组为准，空数组也覆盖）
					set({
						user,
						permissions: Array.isArray(data.permissions)
							? data.permissions
							: get().permissions,
					});
					// 非家院校被服务端选为默认（家院校没有任何授予）时，同步顶栏快照，
					// 否则顶栏会显示家院校、请求头却已指向另一所。
					syncSchoolScope(data);
				} catch (err: unknown) {
					const status = httpStatusOf(err);
					// 视角被撤销（或换了账号后残留）→ 服务端 403「视角不可用」。
					// 清掉本地选择后重试一次：下一次请求不带 header，服务端回落默认视角。
					// 递归有界：clear 后 active 为空，不进这个分支。
					if (status === 403) {
						// 只有"确实清掉了本地选择"才重试；否则 403 来自别的约束，递归只会刷请求。
						const hadPersona = usePersonaStore.getState().active != null;
						const hadSchool = useSchoolScopeStore.getState().school != null;
						if (hadPersona || hadSchool) {
							console.warn("[authStore] /auth/me 403 — 清除失效视角/院校后重试");
							usePersonaStore.getState().clear();
							useSchoolScopeStore.getState().setSchool(null);
							return get().refreshUser();
						}
						console.warn("[authStore] /auth/me 403 — 无本地选择可清，保持现有会话");
						return;
					}
					// 仅 401 视为会话失效；网络抖动/服务端瞬时错误保留会话（与 refreshAuth 一致）
					const is401 = status === 401;
					if (is401) {
						console.warn("[authStore] refreshUser 401 — 清除会话");
						get().logout();
					} else {
						console.warn("[authStore] refreshUser 网络/服务端错误 — 保持现有会话", err);
					}
				}
			},

			/**
			 * 冷启动会话恢复时的权限 revalidation：拉一次 `/auth/me`，用现取结果覆盖持久化快照。
			 *
			 * 为什么必须有：`localStorage` 里的 `permissions` 是上次会话的快照，可能早于部署后的
			 * 授权变更（新授予的权限被旧快照挡在 403 页）。
			 * 期间 `sessionReady=false`，`ProtectedRoute` 先显示加载态 —— 门禁不会拿旧快照判定。
			 *
			 * 与 `refreshUser()` 同口径：401 → 清会话；网络/5xx → 保留会话，不把用户踢下线。
			 *
			 * 顺带承担冷启动的"会话已建立"副作用：起 24h token 刷新定时器（见 onRehydrateStorage 的 TDZ 说明）。
			 */
			revalidateSession: async (): Promise<void> => {
				if (get().token == null) {
					set({ sessionReady: true });
					return;
				}
				set({ sessionReady: false });
				try {
					await get().refreshUser();
				} finally {
					set({ sessionReady: true });
					if (get().token) startRefreshTimer();
				}
			},

			logout: (): void => {
				if (isLoggingOut) return;
				isLoggingOut = true;
				stopRefreshTimer();
				apiLogout().catch(() => {}).finally(() => { isLoggingOut = false; });
				set({ user: null, token: null, permissions: [] });
				// 「当前院校」是上一个平台的偏好，换人登录不能带走（换账号后作用域必须回到全部院校）
				useSchoolScopeStore.getState().setSchool(null);
				// 视角同理：上一个账号的视角选择对下一个人没有意义，且可能不在其授予集合里
				usePersonaStore.getState().clear();
				dispatchForceLogout();
			},
		}),
		{
			name: "nursing-auth",
			partialize: (state): PersistedState => ({
				user: state.user,
				token: state.token,
				permissions: state.permissions,
			}),
			version: 2,
			migrate: (persisted) => {
				// v1 会话用户把 id 存成 user_id；v2 起统一用 `UserBrief` 的 `id`。
				const p = persisted as PersistedState & { user?: (User & { user_id?: number }) | null };
				if (p.user && p.user.user_id != null) {
					p.user.id = p.user.user_id;
					delete p.user.user_id;
				}
				return p as PersistedState;
			},
			onRehydrateStorage: () => {
				return (state, error) => {
					if (error || !state?.token) return;
					// 冷启动先用持久化的授予集合把视角选择器点亮：`available` 不持久化，
					// 若 `/auth/me` 此刻网络失败，切换器会误显示"账号只有这一个视角"并锁死。
					// 服务端仍会按真实授予拒绝越权视角，这里只是让 UI 在落定前不撒谎。
					const cached = state.user?.personas;
					if (Array.isArray(cached) && cached.length > 0) {
						usePersonaStore.getState().setAvailable(cached, state.user?.active_persona ?? null);
					}
					// 冷启动恢复会话：立刻 revalidate 权限，别让路由门禁沿用持久化快照。
					// **必须异步**：persist 的 rehydrate 回调在 store 创建期间同步触发，此刻模块常量
					// `useAuthStore` 还在 TDZ；axios 请求拦截器一读 `useAuthStore.getState()` 就抛
					// ReferenceError，被 refreshUser 当成网络错误吞掉 —— 冷启动 revalidation 实际
					// 从未生效（权限/视角停留在旧快照）。queueMicrotask 让回调在本轮同步执行之后
					// （模块常量已初始化）再跑。
					queueMicrotask(() => {
						void state.revalidateSession();
					});
				};
			},
		},
	),
);

export default useAuthStore;
