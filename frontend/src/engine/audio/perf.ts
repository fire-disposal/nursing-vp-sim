/**
 * 设备性能校准与运行监测 —— 决定这套设备能不能"边听边跑 VAD"。
 *
 * 判据是**实测帧间隔**，不是 `hardwareConcurrency`：8 核的老笔记本在插电省电模式下
 * 照样跑不动 ONNX，而 4 核的平板可能毫无压力。校准看的是 VAD 主线程处理一帧的真实
 * 间隔（`onFrameProcessed` 的时间轴），运行期持续看多个窗口的 p75。
 *
 * 纯逻辑、无浏览器 API：`useVoiceDialogue` 只负责把时间戳喂进来，单测直接构造序列。
 */

export interface PerformancePolicy {
	/** 校准窗口：除预热帧外收集这么多帧就下结论。 */
	calibrationFrames: number;
	/** 预热帧：模型首次推理含编译/分配，间隔必然偏高，跳过不计。 */
	warmupFrames: number;
	/** 判定阈值：p75 帧间隔超过它 → 这套设备跟不上实时。 */
	slowP75Ms: number;
	/** 运行期单个窗口的样本数。 */
	windowFrames: number;
	/** 连续多少个坏窗口才降级（单窗口抖动不算）。 */
	badWindowsForDegrade: number;
}

export const DEFAULT_PERFORMANCE_POLICY: PerformancePolicy = {
	calibrationFrames: 15,
	warmupFrames: 3,
	slowP75Ms: 80,
	windowFrames: 10,
	badWindowsForDegrade: 2,
};

export type PerformanceState = "calibrating" | "ok" | "degraded";

export function percentile(values: readonly number[], ratio: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
	return sorted[index];
}

/**
 * 帧间隔监测器。校准期只收集不判定（调用方必须同时抑制 VAD 事件）；
 * `push` 返回 `true` 表示这一刻状态落定（ok 或 degraded），调用方据此启/停 VAD。
 */
export class FrameTimingMonitor {
	private readonly policy: PerformancePolicy;
	private state: PerformanceState = "calibrating";
	private last: number | null = null;
	private framesSeen = 0;
	private gaps: number[] = [];
	private windowGaps: number[] = [];
	private badWindows = 0;

	constructor(policy: Partial<PerformancePolicy> = {}) {
		this.policy = { ...DEFAULT_PERFORMANCE_POLICY, ...policy };
	}

	get current(): PerformanceState {
		return this.state;
	}

	/** 校准是否已下结论：`false` 时 VAD 事件必须丢弃。 */
	get calibrated(): boolean {
		return this.state !== "calibrating";
	}

	/** 喂一帧到达时间（ms，单调时钟）。落定/降级的那一刻返回 `true`。 */
	push(timestamp: number): boolean {
		if (this.state === "degraded") return false;
		if (this.last === null) {
			this.last = timestamp;
			return false;
		}
		const gap = timestamp - this.last;
		this.last = timestamp;
		this.framesSeen += 1;
		if (this.framesSeen <= this.policy.warmupFrames) return false;
		this.gaps.push(gap);

		if (this.state === "calibrating") {
			if (this.gaps.length < this.policy.calibrationFrames) return false;
			const slow = percentile(this.gaps, 0.75) > this.policy.slowP75Ms;
			this.state = slow ? "degraded" : "ok";
			this.windowGaps = [];
			return true;
		}

		this.windowGaps.push(gap);
		if (this.windowGaps.length < this.policy.windowFrames) return false;
		const bad = percentile(this.windowGaps, 0.75) > this.policy.slowP75Ms;
		this.windowGaps = [];
		this.badWindows = bad ? this.badWindows + 1 : 0;
		if (this.badWindows < this.policy.badWindowsForDegrade) return false;
		this.state = "degraded";
		return true;
	}

	/** 校准超时：没攒够帧也照样下结论（慢设备不该把用户卡在校准里）。 */
	timeout(): boolean {
		if (this.state !== "calibrating") return false;
		const slow = this.gaps.length > 0 && percentile(this.gaps, 0.75) > this.policy.slowP75Ms;
		this.state = slow ? "degraded" : "ok";
		this.windowGaps = [];
		return true;
	}

	/** 校准期实测 p75（诊断/提示文案用）。 */
	get p75(): number {
		return percentile(this.gaps, 0.75);
	}
}
