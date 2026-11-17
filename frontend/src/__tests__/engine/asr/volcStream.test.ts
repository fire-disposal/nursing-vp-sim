import { describe, expect, it, vi } from "vitest";
import { buildAsrUrl, closeReason, connectVolcAsr, type VolcAsrCloseReason } from "@/engine/asr/volcStream";

/**
 * 云 ASR 传输协议：URL 带 token/record_id、二进制上行、`stop` 是文本、关闭码翻译。
 * 全部用假 WebSocket，不发真实请求、不碰任何付费服务。
 */

class FakeSocket {
	static last: FakeSocket | null = null;
	url: string;
	readyState = 0;
	binaryType = "blob";
	sent: Array<string | ArrayBuffer> = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
	onclose: ((event: { code: number }) => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(url: string) {
		this.url = url;
		FakeSocket.last = this;
	}

	send(data: string | ArrayBuffer) {
		this.sent.push(data);
	}

	close() {
		this.readyState = 3;
	}

	open() {
		this.readyState = 1;
		this.onopen?.();
	}

	message(payload: unknown) {
		this.onmessage?.({ data: JSON.stringify(payload) });
	}

	shut(code: number) {
		this.readyState = 3;
		this.onclose?.({ code });
	}
}

function connect(handlers: Parameters<typeof connectVolcAsr>[0] extends infer O ? Partial<O> : never = {}) {
	const fake = () => FakeSocket.last as FakeSocket;
	const promise = connectVolcAsr({
		token: "jwt-token",
		recordId: 42,
		// 假 socket 只实现被用到的成员：结构断言成 WebSocket 是有意的窄替身
		factory: (url) => new FakeSocket(url) as unknown as WebSocket,
		...handlers,
	});
	return { promise, fake };
}

describe("buildAsrUrl", () => {
	it("carries token and record_id on the same-origin path", () => {
		const url = buildAsrUrl("/api/asr/stream", "abc", 7);
		expect(url).toBe("ws://localhost:3000/api/asr/stream?token=abc&record_id=7");
	});

	it("recordId=0 uses the demo path without a training record", () => {
		const url = buildAsrUrl("/api/voice-demo/asr", "abc", 0);
		expect(url).toBe("ws://localhost:3000/api/voice-demo/asr?token=abc");
	});
});

describe("closeReason", () => {
	it("maps the documented close codes", () => {
		expect(closeReason(4401, false)).toBe("disabled");
		expect(closeReason(4001, true)).toBe("unauthorized");
		expect(closeReason(4003, true)).toBe("forbidden");
		expect(closeReason(4500, true)).toBe("upstream");
	});
});

describe("connectVolcAsr", () => {
	it("resolves on open and forwards partial/definite/end", async () => {
		const onPartial = vi.fn();
		const onDefinite = vi.fn();
		const onEnd = vi.fn();
		const { promise, fake } = connect({ onPartial, onDefinite, onEnd });
		fake().open();
		const connection = await promise;
		const socket = fake();
		socket.message({ type: "partial", text: "你哪里" });
		socket.message({ type: "definite", text: "你哪里不舒服" });
		socket.message({ type: "end" });
		expect(onPartial).toHaveBeenCalledWith("你哪里");
		expect(onDefinite).toHaveBeenCalledWith("你哪里不舒服");
		expect(onEnd).toHaveBeenCalledTimes(1);
		expect(connection.state).toBe("open");
	});

	it("sends PCM as binary and stop as a text frame", async () => {
		const { promise, fake } = connect();
		fake().open();
		const connection = await promise;
		const pcm = new ArrayBuffer(8);
		connection.send(pcm);
		connection.finish(50);
		const [binary, text] = fake().sent;
		expect(binary).toBe(pcm);
		expect(JSON.parse(text as string)).toEqual({ type: "stop" });
	});

	it("rejects with the close reason when the server has no ASR configured", async () => {
		const { promise, fake } = connect();
		fake().shut(4401);
		await expect(promise).rejects.toThrow("disabled");
	});

	it("reports upstream errors after the socket is open", async () => {
		const reasons: VolcAsrCloseReason[] = [];
		const { promise, fake } = connect({ onError: (reason) => reasons.push(reason) });
		fake().open();
		await promise;
		fake().message({ type: "error", message: "upstream failed" });
		expect(reasons).toEqual(["upstream"]);
	});
});
