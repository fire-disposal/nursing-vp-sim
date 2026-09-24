import { useEffect, useRef, useState } from "react";
import { postToolCommand } from "@/api/training";
import type { MessageBus } from "@/engine/types";
import { subscribeWSConnection } from "./useTrainingWS";

/**
 * 工具指令面桥（Phase 2.5）— HTTP 请求/响应替代 WS tool 通道。
 *
 * 组件契约不变：监听 bus "tool:invoke"，完成后面向 bus 发出
 * "tool:result" / "scene:state" / "emotion:changed"。写操作串行执行，并通过
 * 完成屏障供交卷流程等待；乐观并发冲突会使用服务端版本号重试一次。
 */

interface PendingCommand {
	task: Promise<void>;
	tool: string;
}

const pendingMutations = new Map<number, PendingCommand[]>();

interface ToolErrorDetails {
	status?: number;
	currentRevision?: number;
	message?: string;
}

function getToolErrorDetails(error: unknown): ToolErrorDetails {
	if (!error || typeof error !== "object" || !("response" in error)) {
		return { message: error instanceof Error ? error.message : undefined };
	}
	const response = error.response;
	if (!response || typeof response !== "object") return {};

	const details: ToolErrorDetails = {};
	if ("status" in response && typeof response.status === "number") {
		details.status = response.status;
	}
	if (!("data" in response) || !response.data || typeof response.data !== "object") {
		return details;
	}
	const data = response.data;
	if (!("detail" in data)) return details;
	const detail = data.detail;
	if (typeof detail === "string") return { ...details, message: detail };
	if (!detail || typeof detail !== "object") return details;
	if ("current_revision" in detail && typeof detail.current_revision === "number") {
		details.currentRevision = detail.current_revision;
	}
	if ("message" in detail && typeof detail.message === "string") {
		details.message = detail.message;
	}
	return details;
}

function trackMutation(recordId: number, tool: string, task: Promise<void>) {
	const commands = pendingMutations.get(recordId) ?? [];
	const entry: PendingCommand = { task, tool };
	commands.push(entry);
	pendingMutations.set(recordId, commands);
	void task
		.finally(() => {
			const list = pendingMutations.get(recordId);
			if (!list) return;
			const index = list.indexOf(entry);
			if (index >= 0) list.splice(index, 1);
			if (list.length === 0) pendingMutations.delete(recordId);
		})
		.catch(() => {});
}

/**
 * 等待该记录上在途的工具写入落盘（队列串行，故会一并等到排队中的指令）。
 *
 * `failTool` 限定「失败该抛给调用方」的工具：交卷/离开只该被护理记录落盘失败拦住，
 * 查体/测验的失败由各自面板就地展示，不应阻断问诊与交卷。
 */
export async function waitForPendingToolCommands(recordId: number, failTool?: string): Promise<void> {
	while (true) {
		const commands = [...(pendingMutations.get(recordId) ?? [])];
		if (commands.length === 0) return;
		const settled = await Promise.allSettled(commands.map((command) => command.task));
		settled.forEach((result, index) => {
			if (result.status !== "rejected") return;
			const tool = commands[index].tool;
			if (failTool === undefined || tool === failTool) throw result.reason;
		});
	}
}

export function useToolBridge(bus: MessageBus) {
	const revisionRef = useRef<number | null>(null);
	const queueRef = useRef<Promise<void>>(Promise.resolve());
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const onToolInvoke = (payload: {
			tool: string;
			action: string;
			params?: Record<string, unknown>;
			recordId: number;
		}) => {
			const cmd = `${payload.tool}.${payload.action}`;
			const idemKey = crypto.randomUUID();

			const execute = async () => {
				const invoke = () =>
					postToolCommand(payload.recordId, {
						cmd,
						params: payload.params ?? {},
						idem_key: idemKey,
						revision: revisionRef.current,
					});
				try {
					let res: Awaited<ReturnType<typeof invoke>>;
					try {
						res = await invoke();
					} catch (err) {
						const details = getToolErrorDetails(err);
						if (details.status !== 409 || details.currentRevision === undefined) {
							throw err;
						}
						revisionRef.current = details.currentRevision;
						res = await invoke();
					}

					revisionRef.current = res.revision;
					if (!res.ok) {
						throw new Error(res.error || "工具操作失败，请重试");
					}
					bus.emit("tool:result", {
						requestId: idemKey,
						tool: payload.tool,
						action: payload.action,
						ok: true,
						data: res.data ?? {},
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
				} catch (err) {
					const details = getToolErrorDetails(err);
					if (details.currentRevision !== undefined) {
						revisionRef.current = details.currentRevision;
					}
					const message =
						details.message ??
						(err instanceof Error ? err.message : undefined) ??
						"工具操作失败，请重试";
					bus.emit("tool:result", {
						requestId: idemKey,
						tool: payload.tool,
						action: payload.action,
						ok: false,
						data: {},
						error: message,
					});
					throw new Error(message);
				}
			};

			const task = queueRef.current.then(execute, execute);
			queueRef.current = task.catch(() => {});
			if (payload.action !== "load") trackMutation(payload.recordId, payload.tool, task);
			void task.catch(() => {});
		};
		const unsubscribe = bus.on("tool:invoke", onToolInvoke);
		setReady(true);
		return unsubscribe;
	}, [bus]);

	useEffect(() => {
		revisionRef.current = null;
		queueRef.current = Promise.resolve();
	}, [bus]);

	useEffect(() => subscribeWSConnection(() => {}), []);

	return ready;
}
