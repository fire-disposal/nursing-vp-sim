import { describe, expect, it } from "vitest";
import {
	DEFAULT_PERFORMANCE_POLICY,
	FrameTimingMonitor,
	percentile,
} from "@/engine/audio/perf";

/** 生成一段等间隔的帧到达时间序列（ms）。 */
function frames(start: number, count: number, step: number): number[] {
	return Array.from({ length: count }, (_, index) => start + index * step);
}

describe("percentile", () => {
	it("returns 0 for empty input", () => {
		expect(percentile([], 0.75)).toBe(0);
	});

	it("uses nearest-rank so p75 ignores a single outlier when most frames are on time", () => {
		const gaps = [...Array(9).fill(32), 400];
		expect(percentile(gaps, 0.75)).toBe(32);
	});
});

describe("FrameTimingMonitor 校准", () => {
	it("skips warmup frames before measuring", () => {
		const monitor = new FrameTimingMonitor();
		// 预热帧间隔 500ms（模型编译），之后每 32ms 一帧
		const times = [0, 500, 1000, 1500, ...frames(1500, 20, 32)];
		for (const t of times) monitor.push(t);
		expect(monitor.current).toBe("ok");
		expect(monitor.p75).toBe(32);
	});

	it("calibrating state suppresses events until it concludes", () => {
		const monitor = new FrameTimingMonitor();
		monitor.push(0);
		monitor.push(32);
		expect(monitor.calibrated).toBe(false);
	});

	it("degrades when p75 frame spacing cannot keep real time", () => {
		const monitor = new FrameTimingMonitor();
		const times = [0, ...frames(200, 40, 120)];
		let settled = false;
		for (const t of times) settled = monitor.push(t) || settled;
		expect(settled).toBe(true);
		expect(monitor.current).toBe("degraded");
	});

	it("concludes ok even if the timeout fires before enough frames", () => {
		const monitor = new FrameTimingMonitor();
		monitor.push(0);
		monitor.push(32);
		expect(monitor.timeout()).toBe(true);
		expect(monitor.current).toBe("ok");
	});

	it("timeout on an empty window concludes ok (no evidence of slowness)", () => {
		const monitor = new FrameTimingMonitor();
		expect(monitor.timeout()).toBe(true);
		expect(monitor.current).toBe("ok");
	});
});

describe("FrameTimingMonitor 运行监测", () => {
	function calibrateOk(): FrameTimingMonitor {
		const monitor = new FrameTimingMonitor();
		for (const t of frames(0, 20, 32)) monitor.push(t);
		expect(monitor.current).toBe("ok");
		return monitor;
	}

	it("tolerates a single bad window (transient jank)", () => {
		const monitor = calibrateOk();
		const policy = DEFAULT_PERFORMANCE_POLICY;
		let t = 20 * 32;
		// 一个坏窗口
		for (let i = 0; i < policy.windowFrames; i += 1) {
			t += 200;
			monitor.push(t);
		}
		expect(monitor.current).toBe("ok");
	});

	it("degrades after several consecutive bad windows", () => {
		const monitor = calibrateOk();
		const policy = DEFAULT_PERFORMANCE_POLICY;
		let t = 20 * 32;
		let settled = false;
		for (let w = 0; w < policy.badWindowsForDegrade && !settled; w += 1) {
			for (let i = 0; i < policy.windowFrames; i += 1) {
				t += 200;
				settled = monitor.push(t) || settled;
			}
		}
		expect(settled).toBe(true);
		expect(monitor.current).toBe("degraded");
	});

	it("never returns to ok once degraded", () => {
		const monitor = new FrameTimingMonitor();
		for (const t of frames(0, 40, 120)) monitor.push(t);
		expect(monitor.current).toBe("degraded");
		for (const t of frames(5000, 40, 32)) expect(monitor.push(t)).toBe(false);
		expect(monitor.current).toBe("degraded");
	});
});
