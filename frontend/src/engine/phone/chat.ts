import type { PhoneEmotionLabel } from "./types";
import { accessHeaders } from "@/utils/accessContext";

/**
 * 演示 LLM 链路 —— `POST /api/voice-demo/chat/stream`（SSE）。
 *
 * 角色人格由后端权威 Prompt 决定，这里只负责：拼请求、读 `data: {...}` 帧、
 * 把文本块交给调用方（进患者气泡 + TTS 队列）、支持 abort。
 *
 * 与训练聊天**不共用**任何状态：没有 record_id，没有历史落库，也没有评分。
 */

export const DEMO_CHAT_PATH = "/api/voice-demo/chat/stream";

/** 一问一答的短历史（student/patient 交替）。 */
export interface DemoHistoryMessage {
	role: "student" | "patient";
	content: string;
}

export interface DemoChatTurn {
	character_id: string;
	session_id: string;
	history: DemoHistoryMessage[];
	/** 当前主导情绪标签：后端只据此写语气与日志；四维向量留在本地状态机。 */
	emotion_state: PhoneEmotionLabel;
	/** 快捷用例：让后端给一段长回复（验证打断链路）。 */
	test_mode?: "long_response";
}

export interface DemoChatHandlers {
	onChunk?: (text: string) => void;
	onDone?: () => void;
	onError?: (message: string) => void;
}

export interface DemoChatOptions extends DemoChatHandlers {
	signal?: AbortSignal;
	/** 依赖注入（单测用）。 */
	fetchImpl?: typeof fetch;
}

/** 后端历史契约：LLM 只认 user/assistant，页面内部用 student/patient。 */
export interface DemoApiHistoryMessage {
	role: "user" | "assistant";
	content: string;
}

export interface DemoChatRequestBody {
	character_id: string;
	session_id: string;
	history: DemoApiHistoryMessage[];
	emotion_state: PhoneEmotionLabel;
	test_mode?: "long_response";
}

/** 请求体构造（纯函数，便于断言契约）。 */
export function buildChatRequest(turn: DemoChatTurn): DemoChatRequestBody {
	return {
		character_id: turn.character_id,
		session_id: turn.session_id,
		history: turn.history.map((message) => ({
			role: message.role === "student" ? "user" : "assistant",
			content: message.content,
		})),
		emotion_state: turn.emotion_state,
		...(turn.test_mode ? { test_mode: turn.test_mode } : {}),
	};
}

/**
 * 发一轮并读流。
 *
 * SSE 帧口径与训练聊天一致：`data: {"content": "..."}`（可多次）、
 * `data: {"done": true}` 收尾、`data: {"error": "..."}` 报错。
 */
export async function streamDemoChat(turn: DemoChatTurn, options: DemoChatOptions = {}): Promise<string> {
	const { signal, onChunk, onDone, onError, fetchImpl = fetch } = options;
	if (signal?.aborted) return "";
	const response = await fetchImpl(DEMO_CHAT_PATH, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...accessHeaders() },
		body: JSON.stringify(buildChatRequest(turn)),
		signal,
	}).catch((err: unknown) => {
		// 打断（abort）不是错误：调用方已经拿到它需要的语义，这里只需静默收尾。
		if (signal?.aborted) return null;
		throw err;
	});
	if (!response) return "";
	if (!response.ok) {
		const message = `对话服务不可用：HTTP ${response.status}`;
		onError?.(message);
		throw new Error(message);
	}
	if (!response.body) {
		onError?.("对话服务返回空响应");
		return "";
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let full = "";
	let announced = false;
	const announceDone = () => {
		if (announced) return;
		announced = true;
		onDone?.();
	};
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const frames = buffer.split("\n\n");
			buffer = frames.pop() ?? "";
			for (const frame of frames) {
				const line = frame.split("\n").find((l) => l.startsWith("data: "));
				if (!line) continue;
				let data: { content?: string; done?: boolean; error?: string };
				try {
					data = JSON.parse(line.slice(6));
				} catch {
					continue;
				}
				if (data.error) {
					onError?.(data.error);
					return full;
				}
				if (typeof data.content === "string" && data.content) {
					full += data.content;
					onChunk?.(data.content);
				}
				if (data.done) {
					announceDone();
					return full;
				}
			}
		}
	} catch (err) {
		// 主动打断不是错误：静默收尾，已收到的文本照常交给调用方。
		if (signal?.aborted) return full;
		const message = (err as Error)?.message ?? "对话流中断";
		onError?.(message);
		return full;
	} finally {
		try {
			reader.releaseLock();
		} catch {
			/* 已取消 */
		}
	}
	announceDone();
	return full;
}

/** 历史裁剪：只保留最近 N 轮（后端 Prompt 自己带剧情，不需要整段转录）。 */
export function trimHistory(history: DemoHistoryMessage[], maxMessages = 12): DemoHistoryMessage[] {
	return history.length <= maxMessages ? history : history.slice(-maxMessages);
}
