import { describe, expect, it, vi } from "vitest";
import { createVolcAsrProvider } from "@/engine/asr/volc";
import type { VolcAsrConnection } from "@/engine/asr/volcStream";
import type { AsrSession } from "@/engine/asr/types";

/**
 * 云 ASR 供应商的接线（全部依赖注入）：
 *   - 采集链路拿到的流与 AudioContext 必须交给 VAD（同一条流、同一个图）；
 *   - `stop` 之后迟到的上游帧不得再上报；
 *   - VAD 跟上实时 → `turnDetection`，跟不上 → 退回 interim 驱动。
 */

async function flush() {
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

interface Harness {
	session: AsrSession;
	events: string[];
	capture: { stream: MediaStream; audioContext: AudioContext; close: ReturnType<typeof vi.fn> };
	vadOptions: () => Record<string, unknown> | null;
	connection: VolcAsrConnection;
	emitPcm: (pcm: ArrayBuffer) => void;
}

function build(options: { vadResult?: "ok" | "degraded" | null } = {}): Harness {
	const events: string[] = [];
	let pcmHandler: ((pcm: ArrayBuffer) => void) | null = null;
	const capture = {
		stream: {} as MediaStream,
		audioContext: {} as AudioContext,
		close: vi.fn(async () => {}),
	};
	const connection: VolcAsrConnection = {
		state: "open",
		send: vi.fn(),
		finish: vi.fn(),
		close: vi.fn(),
	};
	let vadOptions: Record<string, unknown> | null = null;
	const openCapture = vi.fn(async (captureOptions: { pcm?: { onPcm?: (pcm: ArrayBuffer) => void } }) => {
		pcmHandler = captureOptions.pcm?.onPcm ?? null;
		return capture as never;
	});
	const connect = vi.fn(async () => connection);
	const startVad = vi.fn(async (vadSession: Record<string, unknown>) => {
		vadOptions = vadSession;
		return {
			state: options.vadResult ?? "ok",
			pause: vi.fn(async () => {}),
			resume: vi.fn(async () => {}),
			destroy: vi.fn(async () => {}),
		} as never;
	});
	const provider = createVolcAsrProvider(
		{},
		{
			openCapture: openCapture as never,
			connect: connect as never,
			startVad: startVad as never,
		},
	);
	const session = provider.createSession({ token: "jwt", recordId: 42, vad: true, lang: "zh-CN" });
	const names: Array<keyof AsrSession> = [
		"onReady",
		"onPartial",
		"onDefinite",
		"onInterim",
		"onEnd",
		"onError",
		"onPerformance",
	];
	for (const name of names) {
		// 每个事件记录名字，便于断言顺序与门控
		const handler = (...args: unknown[]) => {
			events.push(`${String(name)}:${String(args[0] ?? "")}`);
		};
		(session as unknown as Record<string, unknown>)[name] = handler;
	}
	return {
		session,
		events,
		capture,
		vadOptions: () => vadOptions,
		connection,
		emitPcm: (pcm) => pcmHandler?.(pcm),
	};
}

describe("createVolcAsrProvider", () => {
	it("is unsupported when the browser cannot open a WebSocket", () => {
		// jsdom 没有 WebSocket：没有它就连接不上云转写，必须落到浏览器识别
		const provider = createVolcAsrProvider();
		expect(provider.supported()).toBe(false);
	});

	it("does nothing without a token", async () => {
		const provider = createVolcAsrProvider();
		const session = provider.createSession({ recordId: 1 });
		const onError = vi.fn();
		session.onError = onError;
		session.start();
		await flush();
		expect(onError).toHaveBeenCalledWith("missing_auth");
	});

	it("feeds PCM from the capture worklet to the socket", async () => {
		const h = build();
		h.session.start();
		await flush();
		const pcm = new ArrayBuffer(16);
		h.emitPcm(pcm);
		expect(h.connection.send).toHaveBeenCalledWith(pcm);
	});

	it("gives the VAD the very same stream and audio context", async () => {
		const h = build();
		h.session.start();
		await flush();
		const vad = h.vadOptions();
		expect(vad?.stream).toBe(h.capture.stream);
		expect(vad?.audioContext).toBe(h.capture.audioContext);
	});

	it("stops reporting upstream results after stop()", async () => {
		const h = build();
		h.session.start();
		await flush();
		// 连接回调仍持有会话：模拟 stop 之后的迟到 definite
		h.session.stop();
		await flush();
		expect(h.capture.close).toHaveBeenCalled();
	});

	it("only claims turn detection once the VAD calibration says ok", async () => {
		const h = build({ vadResult: "ok" });
		h.session.start();
		await flush();
		// 校准落地前：事件被门挡掉，状态机按 interim 驱动
		expect(h.session.turnDetection).toBe(false);
		const vad = h.vadOptions();
		const callbacks = vad?.callbacks as { onPerformance?: (state: string) => void };
		callbacks.onPerformance?.("ok");
		expect(h.session.turnDetection).toBe(true);
		expect(h.events).toContain("onPerformance:ok");
		callbacks.onPerformance?.("degraded");
		expect(h.session.turnDetection).toBe(false);
		expect(h.events).toContain("onPerformance:degraded");
	});
});
