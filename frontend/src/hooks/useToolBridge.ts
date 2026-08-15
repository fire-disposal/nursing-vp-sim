import { useEffect, useRef } from "react";
import { postToolCommand } from "@/api/training";
import type { MessageBus } from "@/engine/types";
import { subscribeWSConnection } from "./useTrainingWS";

/**
 * 工具指令面桥（Phase 2.5）— HTTP 请求/响应替代 WS tool 通道。
 *
 * 组件契约不变：监听 bus "tool:invoke"，完成后面向 bus 发出
 * "tool:result" / "scene:state" / "emotion:changed"（与旧 WS 桥同形，
 * 组件零改动）。结构性收益：
 * - 删除 pending 追踪/结束等待/断线 settle 整套机制（请求/响应天然同步）；
 * - revision 乐观并发：409 时以服务端 current_revision 续发。
 */
export function useToolBridge(bus: MessageBus) {
	const revisionRef = useRef<number | null>(null);

	useEffect(() => {
		const onToolInvoke = (payload: {
			tool: string;
			action: string;
			params?: Record<string, unknown>;
			recordId: number;
		}) => {
			const cmd = `${payload.tool}.${payload.action}`;
			const idemKey = crypto.randomUUID();
			const revision = revisionRef.current;

			postToolCommand(payload.recordId, {
				cmd,
				params: payload.params ?? {},
				idem_key: idemKey,
				revision,
			})
				.then((res) => {
					revisionRef.current = res.revision;
					bus.emit("tool:result", {
						requestId: idemKey,
						tool: payload.tool,
						action: payload.action,
						ok: res.ok,
						data: res.data ?? {},
						error: res.error || undefined,
					});
					if (res.scene && typeof res.scene === "object") {
						bus.emit("scene:state", res.scene as Record<string, unknown>);
					}
					const emotion =
						res.data && typeof res.data === "object"
							? (res.data as Record<string, unknown>).emotion
							: undefined;
					if (emotion && typeof emotion === "object") {
						bus.emit("emotion:changed", emotion as Record<string, unknown>);
					}
				})
				.catch((err) => {
					const detail =
						(err as { response?: { status?: number; data?: { detail?: { current_revision?: number; message?: string } } } })
							?.response?.data?.detail;
					if (typeof detail?.current_revision === "number") {
						// 并发冲突：以服务端最新 revision 续发一次
						revisionRef.current = detail.current_revision;
					}
					const message =
						detail?.message ??
						(err as { message?: string })?.message ??
						"工具操作失败，请重试";
					bus.emit("tool:result", {
						requestId: idemKey,
						tool: payload.tool,
						action: payload.action,
						ok: false,
						data: {},
						error: message,
					});
				});
		};
		return bus.on("tool:invoke", onToolInvoke);
	}, [bus]);

	// 记录切换/刷新时 revision 由服务端响应重建（首次调用 revision=null 不做校验）
	useEffect(() => {
		revisionRef.current = null;
	}, [bus]);

	// 保留 WS 连接订阅以维持连接状态指示（工具不再依赖 WS）
	useEffect(() => subscribeWSConnection(() => {}), []);
}
