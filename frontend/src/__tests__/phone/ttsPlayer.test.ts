import { describe, expect, it, vi } from "vitest";
import { DEMO_TTS_PATH, DemoTTSPlayer } from "@/engine/phone/ttsPlayer";

/**
 * DemoTTSPlayer 的线路契约：请求形状、PCM 流播放、首块延迟、abort 停播、
 * 队列顺序、浏览器兜底。全部依赖注入 —— 不发真实请求、不出声。
 */

interface Harness {
	player: DemoTTSPlayer;
	fetchMock: ReturnType<typeof vi.fn>;
	playStream: ReturnType<typeof vi.fn>;
	playConnectTone: ReturnType<typeof vi.fn>;
	stopPlayer: ReturnType<typeof vi.fn>;
	fallbackSpeak: ReturnType<typeof vi.fn>;
	fallbackStop: ReturnType<typeof vi.fn>;
	events: string[];
}

function makeHarness(
	response:
		| Response
		| ((body: { text: string }) => Response)
		| (() => Promise<Response>) = () =>
		new Response(new Uint8Array([0, 0, 1, 0]), {
			status: 200,
			headers: { "X-TTS-Emotion": "relaxed", "X-TTS-Voice": "zh_female_x", "X-TTS-Sample-Rate": "24000" },
		}),
	options: { playbackBytes?: number } = {},
): Harness {
	const events: string[] = [];
	const playStream = vi.fn(async (_stream: ReadableStream<Uint8Array>, onFirstChunk?: () => void) => {
		onFirstChunk?.();
		return options.playbackBytes ?? 4096;
	});
	const playConnectTone = vi.fn(async () => undefined);
	const stopPlayer = vi.fn();
	const fallbackSpeak = vi.fn(async () => undefined);
	const fallbackStop = vi.fn();
	const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as { text: string };
		return typeof response === "function" ? response(body) : response;
	});
	const player = new DemoTTSPlayer({
		fetchImpl: fetchMock as unknown as typeof fetch,
		player: {
			prime: async () => undefined as never,
			playStream,
			playConnectTone,
			stop: stopPlayer,
			waitIdle: async () => undefined,
			dispose: vi.fn(),
		},
		fallback: {
			speak: fallbackSpeak,
			stop: fallbackStop,
			get speaking() {
				return false;
			},
		},
		speaker: "demo-speaker",
	});
	player.subscribe((event) => events.push(event.type));
	return { player, fetchMock, playStream, playConnectTone, stopPlayer, fallbackSpeak, fallbackStop, events };
}

describe("DemoTTSPlayer", () => {
	it("forwards the connect calibration tone to the audio core", async () => {
		const h = makeHarness();
		await h.player.playConnectTone();
		expect(h.playConnectTone).toHaveBeenCalledTimes(1);
	});

	it("请求共享契约：路径、body 四字段与鉴权头", async () => {
		const h = makeHarness();
		h.player.setContext("irritated", "phone-he-jianfeng");
		await h.player.speak("你好。");
		const [url, init] = h.fetchMock.mock.calls[0];
		expect(url).toBe(DEMO_TTS_PATH);
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({
			text: "你好。",
			emotion_state: "irritated",
			section_id: "phone-he-jianfeng",
			speaker: "demo-speaker",
		});
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it("读响应头回显：情绪 / 音色 / 采样率", async () => {
		const h = makeHarness();
		await h.player.speak("你好。");
		expect(h.player.meta).toEqual({ emotion: "relaxed", voice: "zh_female_x", sampleRate: 24000 });
	});

	it("PCM 流交给播放内核，并上报首块延迟", async () => {
		const h = makeHarness();
		await h.player.speak("第一句。第二句。");
		expect(h.playStream).toHaveBeenCalledTimes(2);
		expect(h.player.firstBlockLatency).not.toBeNull();
		expect(h.events).toContain("first-block");
		expect(h.events).toContain("speaking");
	});

	it("stop() abort 在途请求、停播、清队列", async () => {
		// 请求挂住：stop 必须能在它返回前生效（否则"打断停播"就是假的）
		let rejectHang: (err: Error) => void = () => undefined;
		const hang = new Promise<Response>((_resolve, reject) => {
			rejectHang = reject;
		});
		const h = makeHarness(() => hang as unknown as Response);
		const speaking = h.player.speak("挂住的句子。");
		await vi.waitFor(() => expect(h.fetchMock).toHaveBeenCalled());
		const signal = h.fetchMock.mock.calls[0][1]?.signal as AbortSignal;
		h.player.stop();
		expect(signal.aborted).toBe(true);
		expect(h.stopPlayer).toHaveBeenCalled();
		expect(h.player.speaking).toBe(false);
		rejectHang(new Error("aborted"));
		await speaking;
	});

	it("服务端失败时落到浏览器兜底，且整段只降级一次", async () => {
		const h = makeHarness(() => new Response("nope", { status: 503 }));
		await h.player.speak("一。二。三。");
		expect(h.fallbackSpeak).toHaveBeenCalledTimes(3);
		// 降级后第二、三句不再发请求（不来回切换音色）
		expect(h.fetchMock).toHaveBeenCalledTimes(1);
		expect(h.player.usingFallback).toBe(true);
		expect(h.events).toContain("fallback");
	});

	it("云端返回空音频也走兜底（bytes=0）", async () => {
		const h = makeHarness(undefined, { playbackBytes: 0 });
		await h.player.speak("没有音频。");
		expect(h.fallbackSpeak).toHaveBeenCalledTimes(1);
	});

	it("finish() 把残留句子念完并发出完成事件（带块数）", async () => {
		const h = makeHarness();
		const done = vi.fn();
		h.player.subscribe((e) => {
			if (e.type === "done") done(e.blocks);
		});
		// 流式文本块：只有句读处才会立刻送去合成
		await h.player.speak("一句。");
		await h.player.speak("还没说完的半句");
		expect(h.playStream).toHaveBeenCalledTimes(1);
		await h.player.finish();
		expect(h.playStream).toHaveBeenCalledTimes(2);
		// 完成事件在最后一句**排进播放时间线**之后发出（blocks 只统计已确认出声的块）
		expect(done).toHaveBeenCalledTimes(1);
	});

	it("stop() 会停掉浏览器兜底朗读", async () => {
		const h = makeHarness(() => new Response("boom", { status: 500 }));
		const run = h.player.speak("兜底一句。");
		await run;
		h.player.stop();
		expect(h.fallbackStop).toHaveBeenCalled();
	});
});
