import { QueryClient } from "@tanstack/react-query";

/**
 * 全局查询客户端。
 *
 * 会话边界（登录、登出、token 失效）必须 `clear()`：查询键不含用户身份，
 * 保留上一个账号的数据会让新账号在 staleTime 内先看到别人的列表。
 */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			staleTime: 30_000,
			gcTime: 10 * 60_000,
			// 窗口聚焦不自动 refetch：避免训练/问答页在切标签页回来时
			// 因后台 refetch 触发 isFetching→骨架屏闪烁、打断流式与计时。
			refetchOnWindowFocus: false,
		},
	},
});
