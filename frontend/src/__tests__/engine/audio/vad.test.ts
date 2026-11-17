import { describe, expect, it, vi } from "vitest";
import { startVadSession, VAD_ASSET_PATH,
	VAD_ORT_WASM_BASE, VAD_TUNING, type MicVadLike } from "@/engine/audio/vad";

/**
 * VAD 接线：同一条流、不 stop 轨道、校准期抑制事件、跑不动就暂停。
 * 全部用假 `MicVAD`，不加载 ONNX、不开麦克风。
 */

interface FakeVad extends MicVadLike {
	options: Record<string, unknown>;
	started: number;
	paused: number;
	destroyed: number;
}

function fakeVad(options: Record<string, unknown>): FakeVad {
	let listening = false;
	const vad: FakeVad = {
		options,
		started: 0,
		paused: 0,
		destroyed: 0,
		get listening() {
			return listening;
		},
		set listening(value: boolean) {
			listening = value;
		},
		async start() {
			vad.started += 1;
			listening = true;
		},
		async pause() {
			vad.paused += 1;
			listening = false;
		},
		async destroy() {
			vad.destroyed += 1;
			listening = false;
		},
	};
	return vad;
}

async function setup(intervalMs: number, options: { frames?: number } = {}) {
	const vad = fakeVad({});
	let now = 0;
	const createVad = vi.fn(async (opts: Record<string, unknown>) => {
		Object.assign(vad.options, opts);
		return vad;
	});
	const session = await startVadSession({
		stream: null,
		callbacks: {},
		createVad,
		now: () => now,
		calibrationTimeoutMs: 60_000,
	});
	return {
		vad,
		createVad,
		session,
		advance(frames = options.frames ?? 40) {
			for (let i = 0; i < frames; i += 1) {
				now += intervalMs;
				void (vad.options.onFrameProcessed as () => void)();
			}
		},
	};
}

describe("startVadSession 资源与参数", () => {
	it("points assets at /vad/ and uses the agreed tuning", async () => {
		const { createVad } = await setup(32);
		const options = createVad.mock.calls[0][0];
		expect(options.baseAssetPath).toBe(VAD_ASSET_PATH);
		expect(options.onnxWASMBasePath).toBe(VAD_ORT_WASM_BASE);
		expect(options.model).toBe("v5");
		expect(options).toMatchObject(VAD_TUNING);
	});

	it("reuses the caller's stream and never stops its tracks on pause", async () => {
		const track = { stop: vi.fn() };
		const stream = {
			getTracks: () => [track],
		} as unknown as MediaStream;
		const createVad = vi.fn(async (_options: Record<string, unknown>) => fakeVad({}));
		await startVadSession({ stream, createVad, calibrationTimeoutMs: 60_000 });
		const options = createVad.mock.calls[0][0];
		await expect((options.getStream as () => Promise<MediaStream>)()).resolves.toBe(stream);
		await (options.pauseStream as (s: MediaStream) => Promise<void>)(stream);
		await expect((options.resumeStream as () => Promise<MediaStream>)()).resolves.toBe(stream);
		expect(track.stop).not.toHaveBeenCalled();
	});
});

describe("startVadSession 校准", () => {
	it("suppresses speech events until calibration concludes", async () => {
		const events: string[] = [];
		const vad = fakeVad({});
		let now = 0;
		const session = await startVadSession({
			callbacks: {
				onSpeechStart: () => events.push("start"),
				onSpeechRealStart: () => events.push("real"),
				onSpeechEnd: () => events.push("end"),
			},
			createVad: async (opts) => {
				Object.assign(vad.options, opts);
				return vad;
			},
			now: () => now,
			calibrationTimeoutMs: 60_000,
		});
		expect(session).not.toBeNull();
		const frame = vad.options.onFrameProcessed as () => void;
		const start = vad.options.onSpeechStart as () => void;
		// 校准期：噪声事件必须被丢弃
		now += 32;
		frame();
		start();
		expect(events).toEqual([]);
		for (let i = 0; i < 30; i += 1) {
			now += 32;
			frame();
		}
		expect(session?.state).toBe("ok");
		start();
		expect(events).toEqual(["start"]);
	});

	it("pauses VAD and reports degraded when frames cannot keep up", async () => {
		const states: string[] = [];
		const vad = fakeVad({});
		let now = 0;
		const session = await startVadSession({
			callbacks: { onPerformance: (state) => states.push(state) },
			createVad: async (opts) => {
				Object.assign(vad.options, opts);
				return vad;
			},
			now: () => now,
			calibrationTimeoutMs: 60_000,
		});
		const frame = vad.options.onFrameProcessed as () => void;
		for (let i = 0; i < 40; i += 1) {
			now += 150;
			frame();
		}
		expect(session?.state).toBe("degraded");
		expect(states.at(-1)).toBe("degraded");
		expect(vad.paused).toBeGreaterThan(0);
	});

	it("concludes at the calibration timeout so slow devices are not stuck", async () => {
		vi.useFakeTimers();
		try {
			const states: string[] = [];
			const session = await startVadSession({
				callbacks: { onPerformance: (state) => states.push(state) },
				createVad: async () => fakeVad({}),
				now: () => 0,
				calibrationTimeoutMs: 1000,
			});
			vi.advanceTimersByTime(1000);
			expect(session?.state).toBe("ok");
			expect(states).toContain("ok");
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns null when the VAD fails to initialise", async () => {
		const session = await startVadSession({
			createVad: async () => {
				throw new Error("model 404");
			},
		});
		expect(session).toBeNull();
	});
});
