/**
 * 同源云 ASR 传输层 —— 浏览器 ⇄ `/api/asr/stream` 的 WebSocket 协议。
 *
 * 上行：二进制 = 16kHz 单声道 PCM16LE；文本 = `{"type":"stop"}`。
 * 下行（JSON）：
 *   `{type:"ready"}`                上游会话就绪（可以开始发音频）
 *   `{type:"partial", text}`        中间结果
 *   `{type:"definite", text}`       一句的最终结果（可能为空串）
 *   `{type:"end"}`                  上游正常结束
 *   `{type:"error", message}`       上游/鉴权错误
 *
 * 关闭码契约：4401 = 服务端没配 ASR（前端回退 Web Speech）、4001 鉴权失败、4003 无权限、
 * 4500 上游错误。这里**只做翻译**：连接关了就是关了，不自动重连（重连属于轮次级决策，
 * 由状态机决定是否再开一轮）。
 */

export type VolcAsrCloseReason = "disabled" | "unauthorized" | "forbidden" | "upstream" | "closed";

export interface VolcAsrHandlers {
	onReady?: () => void;
	onPartial?: (text: string) => void;
	onDefinite?: (text: string) => void;
	onEnd?: () => void;
	/** 错误码/关闭原因，原样交给状态机决定降级。 */
	onError?: (reason: VolcAsrCloseReason) => void;
}

export interface VolcAsrConnectionOptions extends VolcAsrHandlers {
	/** 同源路径，默认 `/api/asr/stream`。 */
	path?: string;
	token: string;
	recordId: number;
	/** 依赖注入（单测用）。 */
	factory?: (url: string) => WebSocket;
}

export interface VolcAsrConnection {
	send(pcm: ArrayBuffer): void;
	/** 发送 `stop` 并等上游 `end`（超时直接关）。 */
	finish(timeoutMs?: number): void;
	close(): void;
	readonly state: "connecting" | "open" | "closed";
}

export const ASR_WS_PATH = "/api/asr/stream";

/** 关闭码 → 降级语义（4401 不是错误，是"服务端没配这个能力"）。 */
export function closeReason(code: number, hadOpen: boolean): VolcAsrCloseReason {
	if (code === 4401) return "disabled";
	if (code === 4001) return "unauthorized";
	if (code === 4003) return "forbidden";
	if (code === 4500) return "upstream";
	return hadOpen ? "closed" : "upstream";
}

export function buildAsrUrl(base: string, token: string, recordId: number): string {
	const url = new URL(base, window.location.href);
	url.searchParams.set("token", token);
	url.searchParams.set("record_id", String(recordId));
	if (url.protocol === "http:") url.protocol = "ws:";
	else if (url.protocol === "https:") url.protocol = "wss:";
	return url.toString();
}

/** 打开一条云 ASR 连接。握手失败以关闭原因 reject，让状态机当场决定降级。 */
export function connectVolcAsr(options: VolcAsrConnectionOptions): Promise<VolcAsrConnection> {
	const { token, recordId, path = ASR_WS_PATH } = options;
	let socket: WebSocket;
	try {
		const factory = options.factory ?? ((url: string) => new WebSocket(url));
		socket = factory(buildAsrUrl(path, token, recordId));
	} catch (err) {
		return Promise.reject(err instanceof Error ? err : new Error("upstream"));
	}

	const pending = { resolve: (_: VolcAsrConnection) => {}, reject: (_: unknown) => {} };
	const promise = new Promise<VolcAsrConnection>((resolve, reject) => {
		pending.resolve = resolve;
		pending.reject = reject;
	});
	const { resolve, reject } = pending;
	let state: VolcAsrConnection["state"] = "connecting";
	let ready = false;
	let failed = false;
	let finishTimeout: ReturnType<typeof setTimeout> | undefined;

	const reportError = (reason: VolcAsrCloseReason) => {
		if (failed) return;
		failed = true;
		options.onError?.(reason);
	};

	socket.binaryType = "arraybuffer";

	socket.onopen = () => {
		state = "open";
		resolve({
			get state() {
				return state;
			},
			send(pcm: ArrayBuffer) {
				if (state !== "open") return;
				try {
					socket.send(pcm);
				} catch {
					/* 已断开：等 onclose 统一处理 */
				}
			},
			finish(timeoutMs = 2500) {
				if (state !== "open") {
					socket.close();
					return;
				}
				try {
					socket.send(JSON.stringify({ type: "stop" }));
				} catch {
					/* ignore */
				}
				clearTimeout(finishTimeout);
				finishTimeout = setTimeout(() => socket.close(), timeoutMs);
			},
			close() {
				clearTimeout(finishTimeout);
				try {
					socket.close();
				} catch {
					/* ignore */
				}
			},
		});
	};

	socket.onmessage = (event) => {
		if (typeof event.data !== "string") return;
		let message: { type?: string; text?: string };
		try {
			message = JSON.parse(event.data) as { type?: string; text?: string };
		} catch {
			return;
		}
		switch (message.type) {
			case "ready":
				ready = true;
				options.onReady?.();
				return;
			case "partial":
				options.onPartial?.(message.text ?? "");
				return;
			case "definite":
				options.onDefinite?.(message.text ?? "");
				return;
			case "end":
				options.onEnd?.();
				return;
			case "error":
				reportError("upstream");
				return;
			default:
		}
	};

	socket.onerror = () => {
		if (state === "connecting") {
			state = "closed";
			reject(new Error("upstream"));
		}
	};

	socket.onclose = (event) => {
		const hadOpen = state === "open";
		state = "closed";
		clearTimeout(finishTimeout);
		const reason = closeReason(event?.code ?? 0, hadOpen || ready);
		if (!hadOpen && !ready) {
			reject(new Error(reason));
			return;
		}
		// 正常结束（服务端发过 end 后自己关）不算错误
		if (reason === "closed" && ready) options.onEnd?.();
		else reportError(reason);
	};

	return promise;
}
