import { describe, expect, it, vi } from "vitest";
import { buildChatRequest, DEMO_CHAT_PATH, streamDemoChat, trimHistory } from "@/engine/phone/chat";

/** SSE 帧构造（与后端 `_sse` 同形）。 */
function sse(payload: Record<string, unknown>): Uint8Array {
	return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
}

const TURN = {
	character_id: "su-xiaoman",
	session_id: "phone-test-session",
	history: [{ role: "student" as const, content: "你好" }],
	emotion_state: "anxious_cooperative" as const,
};

describe("演示对话链路", () => {
	it("请求契约：路径 + 四个字段，test_mode 只在需要时出现", async () => {
		const fetchImpl = vi.fn(async () => new Response(streamOf([sse({ done: true })]), { status: 200 }));
		await streamDemoChat(TURN, { fetchImpl: fetchImpl as unknown as typeof fetch });
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(DEMO_CHAT_PATH);
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({
			...TURN,
			history: [{ role: "user", content: "你好" }],
		});
		expect(buildChatRequest({ ...TURN, test_mode: "long_response" }).test_mode).toBe("long_response");
		expect(buildChatRequest(TURN)).not.toHaveProperty("test_mode");
	});

	it("逐块回调文本，done 帧收尾", async () => {
		const fetchImpl = async () =>
			new Response(streamOf([sse({ content: "我" }), sse({ content: "在呢。" }), sse({ done: true })]), { status: 200 });
		const chunks: string[] = [];
		const onDone = vi.fn();
		const full = await streamDemoChat(TURN, {
			fetchImpl: fetchImpl as unknown as typeof fetch,
			onChunk: (c) => chunks.push(c),
			onDone,
		});
		expect(chunks).toEqual(["我", "在呢。"]);
		expect(full).toBe("我在呢。");
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it("abort 之后不再向上报错误，保留已收到文本", async () => {
		const controller = new AbortController();
		const fetchImpl = async () => {
			controller.abort();
			throw new DOMException("aborted", "AbortError");
		};
		const onError = vi.fn();
		const full = await streamDemoChat(TURN, {
			fetchImpl: fetchImpl as unknown as typeof fetch,
			signal: controller.signal,
			onError,
		});
		expect(full).toBe("");
		expect(onError).not.toHaveBeenCalled();
	});

	it("HTTP 失败上报错误并抛出", async () => {
		const fetchImpl = async () => new Response("nope", { status: 502 });
		const onError = vi.fn();
		await expect(
			streamDemoChat(TURN, { fetchImpl: fetchImpl as unknown as typeof fetch, onError }),
		).rejects.toThrow("HTTP 502");
		expect(onError).toHaveBeenCalled();
	});

	it("历史只保留最近若干条", () => {
		const history = Array.from({ length: 20 }, (_, i) => ({
			role: (i % 2 === 0 ? "student" : "patient") as "student" | "patient",
			content: `m${i}`,
		}));
		expect(trimHistory(history, 4).map((m) => m.content)).toEqual(["m16", "m17", "m18", "m19"]);
		expect(trimHistory(history)).toHaveLength(12);
	});
});
