import { create } from "zustand";
import { persist } from "zustand/middleware";
import { sortPersonas } from "@/utils/personas";

/**
 * 视角状态：`available` = 当前会话被授予的视角集合（来自 `/auth/me` 或登录/刷新响应），
 * `active` = 当前生效视角（随请求头 `X-View-Persona` 发出）。
 *
 * 与 `authStore` 分工：authStore 持有会话与权限，本 store 只持有视角选择。
 * **缓存失效不在这里**——store 不是 React 环境，拿不到 queryClient；由 `PersonaSwitcher`
 * 在切换后 `queryClient.clear()`（换视角 = 换了权限口径，所有查询结果都不再成立）。
 */
export const ACTIVE_PERSONA_STORAGE_KEY = "vp.active_persona";

interface PersonaState {
	/** 被授予的视角（服务端为准，可能含前端未认识的取值）。 */
	available: string[];
	/** 当前生效视角；null = 服务端未回话（未登录/旧后端），此时不发送请求头。 */
	active: string | null;
	/**
	 * 用服务端结果覆盖可用集合。`active` 缺省时保留当前选择（若仍被授予），否则退回
	 * 服务端给的默认视角（或列表首项）。
	 */
	setAvailable: (list: readonly string[], active?: string | null) => void;
	setActive: (id: string) => void;
	/** 登出/换账号：清空（含持久化的选择，避免把上一个人的视角带给下一个人）。 */
	clear: () => void;
}

export const usePersonaStore = create<PersonaState>()(
	persist(
		(set, get) => ({
			available: [],
			active: null,

			setAvailable: (list, active) => {
				const available = sortPersonas(list);
				const current = get().active;
				// 本地选择优先：用户切过视角后，`/auth/me` 回话里的 `active_persona` 是**默认视角**，
				// 拿它覆盖会把用户的选择弹回去（服务端只在请求头里知道他的选择）。
				// 仅当本地选择不再被授予（撤权/换账号）时才回落到服务端默认值。
				const next =
					current != null && available.includes(current)
						? current
						: active != null && available.includes(active)
							? active
							: (available[0] ?? null);
				set({ available, active: next });
			},

			setActive: (id) => {
				// 只允许切到已授予的视角：后端会 403，前端不该先发一个注定被拒的请求。
				if (!get().available.includes(id)) return;
				set({ active: id });
			},

			clear: () => set({ available: [], active: null }),
		}),
		{
			name: ACTIVE_PERSONA_STORAGE_KEY,
			// 只持久化「选择」：`available` 是服务端授权，冷启动时以 /auth/me 为准，
			// 留着旧快照只会让切换器短暂显示已撤销的视角。
			partialize: (state): Pick<PersonaState, "active"> => ({ active: state.active }),
			version: 1,
		},
	),
);
