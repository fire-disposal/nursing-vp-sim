import { describe, expect, it, vi } from "vitest";
import { Resampler, TARGET_SAMPLE_RATE, floatToPcm16Bytes, toPcm16 } from "@/engine/audio/resample";

/** 文档：worklet 与主线程各有一份重采样实现，两侧都要过同一套行为。 */
describe("toPcm16", () => {
	it("maps the float range to int16 and clamps outliers", () => {
		expect(toPcm16(0)).toBe(0);
		expect(toPcm16(1)).toBe(0x7fff);
		expect(toPcm16(-1)).toBe(-0x8000);
		expect(toPcm16(2)).toBe(0x7fff);
		expect(toPcm16(-2)).toBe(-0x8000);
	});
});

describe("Resampler", () => {
	it("produces about one target sample per step for a 48k chunk", () => {
		const input = new Float32Array(4800); // 100ms @ 48k
		const out = new Int16Array(4800);
		const written = new Resampler(48000).push(input, out);
		expect(written).toBeGreaterThanOrEqual(1599);
		expect(written).toBeLessThanOrEqual(1600);
	});

	it("keeps a DC level through downsampling", () => {
		const input = new Float32Array(480).fill(0.5);
		const out = new Int16Array(480);
		const written = new Resampler(48000).push(input, out);
		expect(written).toBeGreaterThan(0);
		for (let i = 1; i < written; i += 1) {
			expect(Math.abs(out[i] - 0x3fff)).toBeLessThan(600);
		}
	});

	it("carries the interpolation state across chunk boundaries", () => {
		const resampler = new Resampler(48000);
		const out = new Int16Array(480);
		const first = resampler.push(new Float32Array(480).fill(0.25), out);
		const second = resampler.push(new Float32Array(480).fill(0.25), out);
		expect(first + second).toBeGreaterThanOrEqual(319);
		expect(first + second).toBeLessThanOrEqual(321);
	});

	it("leaves no gap when a chunk starts exactly at a sample boundary", () => {
		const resampler = new Resampler(TARGET_SAMPLE_RATE); // 1:1
		const out = new Int16Array(4);
		const written = resampler.push(new Float32Array([0, 0.5, -0.5, 0.5]), out);
		// 1:1 时最后一帧要等下一块才能插值，不能凭空造样本
		expect(written).toBe(3);
	});
});

describe("floatToPcm16Bytes", () => {
	it("writes little-endian int16 samples", () => {
		const buffer = floatToPcm16Bytes(new Float32Array([0, 1, -1]));
		const view = new DataView(buffer);
		expect(buffer.byteLength).toBe(6);
		expect(view.getInt16(0, true)).toBe(0);
		expect(view.getInt16(2, true)).toBe(0x7fff);
		expect(view.getInt16(4, true)).toBe(-0x8000);
	});
});

describe("MicCapture 打包（不触麦克风）", () => {
	it("reports the constraints the capture asks for", async () => {
		const { micConstraints } = await import("@/engine/audio/mic");
		expect(micConstraints()).toMatchObject({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			video: false,
		});
	});

	it("fails loudly when the browser has no getUserMedia", async () => {
		const { MicCapture } = await import("@/engine/audio/mic");
		const original = navigator.mediaDevices;
		Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
		try {
			await expect(MicCapture.open()).rejects.toThrow("mic_unavailable");
		} finally {
			Object.defineProperty(navigator, "mediaDevices", { value: original, configurable: true });
		}
	});
});

describe("EchoGate", () => {
	it("ignores mic audio while the patient is silent", async () => {
		const { EchoGate } = await import("@/engine/audio/mic");
		const gate = new EchoGate();
		expect(gate.isEcho(0.5)).toBe(false);
	});

	it("treats mic energy near the playback level as echo", async () => {
		const { EchoGate } = await import("@/engine/audio/mic");
		const gate = new EchoGate();
		gate.setReference(0.2);
		expect(gate.isEcho(0.2)).toBe(true);
	});

	it("lets a loud, close talker through", async () => {
		const { EchoGate } = await import("@/engine/audio/mic");
		const gate = new EchoGate();
		gate.setReference(0.02);
		expect(gate.isEcho(0.3)).toBe(false);
		vi.restoreAllMocks();
	});

	it("learns the device echo gain during quiet TTS and narrows the band", async () => {
		const { EchoGate } = await import("@/engine/audio/mic");
		const gate = new EchoGate();
		gate.setReference(0.2, 0);
		for (let t = 100; t <= 1200; t += 50) {
			gate.setReference(0.2, t);
			gate.observe(0.1, t);
		}
		gate.observe(0.1, 3000);

		expect(gate.calibrated).toBe(true);
		expect(gate.isEcho(0.1, 3000)).toBe(true); // learned echo gain 0.5
		expect(gate.isEcho(0.5, 3000)).toBe(false); // real speech much louder than echo path
	});

	it("estimates the acoustic delay before comparing levels", async () => {
		const { EchoGate } = await import("@/engine/audio/mic");
		const gate = new EchoGate();
		const refAt = (t: number) => 0.2 + 0.1 * Math.sin(t / 100);
		const delayed = 200;

		gate.setReference(refAt(0), 0);
		for (let t = 50; t <= 1800; t += 50) {
			gate.setReference(refAt(t), t);
			gate.observe(refAt(t - delayed) * 0.5, t);
		}
		gate.observe(refAt(1800 - delayed) * 0.5, 1800);

		expect(gate.calibrated).toBe(true);
		expect(gate.delay).toBe(delayed);
		gate.setReference(0.3, 2000);
		expect(gate.isEcho(refAt(1800) * 0.5, 2000)).toBe(true);
		gate.setReference(0, 2100);
		expect(gate.isEcho(refAt(1800) * 0.5, 2000)).toBe(true); // tail echo still uses the delayed reference
	});
});
