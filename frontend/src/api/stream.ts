import useAuthStore from "@/stores/authStore";
import { waitForOnline } from "@/utils/network";
import type { SSEHandlers } from "./sse";
import { readSSEStream } from "./sse";
import { getApiErrorMessage } from "@/utils/error";

const MAX_RETRIES = 3;
const FETCH_TIMEOUT = 30_000;

export interface PostStreamOptions {
	url: string;
	body: Record<string, unknown>;
	signal?: AbortSignal;
	/** 网络/超时失败上报钩子（如 telemetry）；不传则静默。 */
	reportFailure?: (kind: string, message: string, url: string) => void;
	handlers: SSEHandlers;
}

/**
 * 统一 POST + SSE 流式请求（聊天、QA 共用）。
 *
 * 内置 401 刷新重试、30s 请求超时、网络错误指数退避重试（含离线等待）。
 * 原 chat.ts / qa.ts 两份逐字拷贝合并于此，行为取两者并集：
 * - 用户主动 abort → 静默返回；fetch 超时 abort → 报"请求超时"。
 * - 401 刷新失败 → logout 后返回（qa.ts 既有行为，更健壮）。
 */
export async function postStream({ url, body, signal, reportFailure, handlers }: PostStreamOptions) {
	const doFetch = (timeoutSignal?: AbortSignal): Promise<Response> => {
		const token = useAuthStore.getState().token;
		const combined = signal ? combineAbortSignals(signal, timeoutSignal) : timeoutSignal;
		return fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(body),
			signal: combined,
		});
	};

	let receivedAnyChunk = false;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const timeoutController = new AbortController();
			const fetchTimeout = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT);

			let resp: Response;
			try {
				resp = await doFetch(timeoutController.signal);
			} finally {
				clearTimeout(fetchTimeout);
			}

			if (resp.status === 401) {
				try {
					const refreshed = await useAuthStore.getState().refreshAuth();
					if (refreshed) {
						const retryTimeout = AbortSignal.timeout(FETCH_TIMEOUT);
						resp = await doFetch(retryTimeout);
					}
				} catch {
					useAuthStore.getState().logout();
					return;
				}
			}

			if (!resp.ok) {
				const err = await resp.json().catch(() => ({ detail: "请求失败" }));
				// detail 可能是数组/对象（FastAPI 校验、业务结构）：直接透传会让它被当 React 子节点渲染，
				// 整块对话区落到 ErrorBoundary。这里统一翻成人话字符串。
				handlers.onError?.(getApiErrorMessage({ response: { data: err, status: resp.status } }, "请求失败"));
				return;
			}

			if (!resp.body) {
				handlers.onError?.("响应体为空");
				return;
			}

			// 一旦收到过任何增量，就**不能再自动重发**：后端已为这条提问落库并可能已产出回复，
			// 重发会在服务端留下两条学生提问 + 两条患者回复，评分按重复问诊计。
			// 此时把失败交给上层（气泡显示"未送达/中断" + 手动重试，由学生决定是否重发）。
			receivedAnyChunk = false;
			await readSSEStream(resp.body.getReader(), {
				...handlers,
				onChunk: (chunk: string) => {
					receivedAnyChunk = true;
					handlers.onChunk?.(chunk);
				},
			});
			return;
		} catch (e: unknown) {
			if (signal?.aborted) return;
			if ((e as Error)?.name === "AbortError") {
				handlers.onError?.("请求超时，请重试");
				reportFailure?.("AbortError", "请求超时，请重试", url);
				return;
			}
			const isNetworkError =
				e instanceof TypeError || (e as { code?: string }).code === "ERR_NETWORK";
			if (receivedAnyChunk) {
				handlers.onError?.("回复中断（已收到部分内容，请手动重试或继续提问）");
				reportFailure?.("StreamBroken", String(e), url);
				return;
			}
			if (!isNetworkError || attempt >= MAX_RETRIES) {
				handlers.onError?.(e instanceof Error ? e.message : "连接失败");
				reportFailure?.("NetworkError", e instanceof Error ? e.message : "连接失败", url);
				return;
			}
			if (!navigator.onLine) {
				handlers.onError?.("网络已断开，等待恢复...");
				try {
					await waitForOnline();
				} catch {
					handlers.onError?.("等待网络超时，请稍后重试");
					return;
				}
			} else {
				await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
			}
		}
	}
}

export function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
	const valid = signals.filter(Boolean) as AbortSignal[];
	if (valid.length === 0) return new AbortController().signal;
	if (valid.length === 1) return valid[0];

	const controller = new AbortController();
	for (const s of valid) {
		if (s.aborted) {
			controller.abort(s.reason);
			return controller.signal;
		}
		s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
	}
	return controller.signal;
}
