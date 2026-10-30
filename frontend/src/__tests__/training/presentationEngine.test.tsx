import { describe, expect, it } from "vitest";
import { cleanup, render } from "@/__tests__/render";
import PatientPresenter from "@/components/training/presentation/PatientPresenter";
import { PRESENTATION_CHAIN } from "@/components/training/presentation/build";
import { fieldAt } from "@/components/training/presentation/engine/draw";
import {
	approach,
	blinkAt,
	breathAt,
	mouthTarget,
	profileFor,
	swayAt,
} from "@/components/training/presentation/engine/motion";
import { rigFor } from "@/components/training/presentation/engine/rig";
import { PRESENTERS } from "@/components/training/presentation/registry";
import type { EmotionSnapshot, RigAvatarPayload } from "@/components/training/presentation/types";

/**
 * 自绘引擎（M2）：能测的是「动作数学」和「rig 与立绘的对应关系」，
 * canvas 像素在 jsdom 里测不了，所以渲染只断言退化路径（没 rig / 减弱动态 → 静态图）。
 */

const WANG = { name: "王建国", age: 68, gender: "male" };
const NEUTRAL: EmotionSnapshot = {
	emotion: "neutral",
	emotion4D: "neutral",
	values: { trust: 50, anxiety: 30, irritation: 20, cooperation: 70 },
};

const IDLE = { sway: 0, nod: 0, breath: 0, blink: 0, jaw: 0, mouth: 0 };

describe("眨眼曲线", () => {
	it("一个周期里只闭一次，且闭到底", () => {
		const interval = 4;
		const samples = Array.from({ length: 400 }, (_, i) => blinkAt(i * 0.01, interval));
		// 4 秒内恰好一次「完全闭眼」的停留
		const closed = samples.filter((v) => v > 0.99).length;
		expect(closed).toBeGreaterThan(2);
		// 大头时间眼睛是睁着的
		expect(samples.filter((v) => v < 0.01).length).toBeGreaterThan(300);
	});

	it("时间上连续：相邻采样不会跳变（不会闪）", () => {
		let prev = blinkAt(0, 3.6);
		for (let t = 0.008; t < 20; t += 0.008) {
			const next = blinkAt(t, 3.6);
			expect(Math.abs(next - prev)).toBeLessThan(0.12);
			prev = next;
		}
	});

	it("同一时刻永远同值（可按时间复现、截图可对齐）", () => {
		expect(blinkAt(7.13, 3.2, 5)).toBe(blinkAt(7.13, 3.2, 5));
	});
});

describe("动作节奏", () => {
	it("呼吸按周期走完整一圈", () => {
		expect(breathAt(0, 3)).toBeCloseTo(0, 6);
		expect(breathAt(0.75, 3)).toBeCloseTo(1, 6);
		expect(breathAt(1.5, 3)).toBeCloseTo(0, 6);
		expect(breathAt(2.25, 3)).toBeCloseTo(-1, 6);
	});

	it("摆动有界，且不是单一正弦（不同时刻不重复）", () => {
		const values = Array.from({ length: 40 }, (_, i) => swayAt(i * 0.4));
		expect(values.every((v) => v >= -1 && v <= 1)).toBe(true);
		expect(new Set(values.map((v) => v.toFixed(4))).size).toBeGreaterThan(35);
	});

	it("包络平滑是「起得快、收得慢」", () => {
		const up = approach(0, 1, 0.05, 0.05, 0.13);
		const down = approach(1, 0, 0.05, 0.05, 0.13);
		expect(up).toBeGreaterThan(1 - down);
		expect(up).toBeLessThan(1);
	});

	it("不说话时口型几乎闭合，说话时跟包络走且不越界", () => {
		expect(mouthTarget(false, 1)).toBeLessThan(0.1);
		expect(mouthTarget(true, 0)).toBeGreaterThan(0.2);
		expect(mouthTarget(true, 1)).toBeGreaterThan(mouthTarget(true, 0.2));
		expect(mouthTarget(true, 5)).toBeLessThanOrEqual(1);
	});

	it("焦虑比回避呼吸更促、摆得更大", () => {
		expect(profileFor("anxious").breathSeconds).toBeLessThan(profileFor("withdrawn").breathSeconds);
		expect(profileFor("anxious").swayDeg).toBeGreaterThan(profileFor("withdrawn").swayDeg);
	});
});

describe("位移场", () => {
	const rig = rigFor("/assets/patient_elder_male-ABCdef12.png");
	if (!rig) throw new Error("rig 缺失");

	it("唇线处位移恒为 0——张嘴不会在嘴上切出一道缝", () => {
		const s = { ...IDLE, jaw: 1, mouth: 1 };
		const p = profileFor("neutral");
		for (const x of [0.3, 0.4, 0.5, 0.6, 0.7]) {
			expect(Math.abs(fieldAt(x, rig.mouth.y, s, p, rig).dy)).toBeLessThan(0.0005);
		}
	});

	it("嘴以下被拉下去，下巴附近位移最大", () => {
		const s = { ...IDLE, jaw: 1 };
		const p = profileFor("neutral");
		const below = fieldAt(0.5, rig.mouth.y + 0.08, s, p, rig).dy;
		expect(below).toBeGreaterThan(0);
		expect(fieldAt(0.5, rig.mouth.y + 0.005, s, p, rig).dy).toBeLessThan(below);
	});

	it("头的横移止于下巴：身体不跟着左右晃（条纹衣服不会错位）", () => {
		const s = { ...IDLE, sway: 1 };
		const p = profileFor("neutral");
		const head = fieldAt(0.5, rig.mouth.y - 0.2, s, p, rig).dx;
		const body = fieldAt(0.5, rig.mouth.y + 0.2, s, p, rig).dx;
		expect(Math.abs(head)).toBeGreaterThan(0);
		expect(Math.abs(body)).toBeLessThan(Math.abs(head) * 0.05);
	});

	it("画布上下边缘没有位移（否则会露出背景板）", () => {
		const s = { ...IDLE, sway: 1, breath: 1, jaw: 1 };
		const p = profileFor("anxious");
		expect(Math.abs(fieldAt(0.5, 0, s, p, rig).dy)).toBeLessThan(1e-9);
		expect(Math.abs(fieldAt(0.5, 1, s, p, rig).dy)).toBeLessThan(1e-9);
	});
});

describe("rig 与立绘的对应", () => {
	it("打包后的带 hash 文件名也能找回 rig", () => {
		expect(rigFor("/assets/patient_child_female-B4gB8zRN.png")).not.toBeNull();
		expect(rigFor("https://cdn.example.com/x/patient_youth_male-CqnHFEjY.png")).not.toBeNull();
	});

	it("写实照片不做 rig（决定：照片保持静态图）", () => {
		expect(rigFor("/assets/case-chest-pain-elder-male-C9DsYvdC.png")).toBeNull();
	});

	it("病例自传的情绪立绘没有 rig —— 不猜几何，交回静态图", () => {
		expect(rigFor("https://cdn.example.com/wang-anxious.png")).toBeNull();
	});

	it("每张固有立绘的五官都在画面内，且眼睛在嘴上面", () => {
		for (const name of [
			"patient_child_male",
			"patient_child_female",
			"patient_youth_male",
			"patient_youth_female",
			"patient_middle_male",
			"patient_middle_female",
			"patient_elder_male",
			"patient_elder_female",
			"nurse_male",
			"nurse_female",
		]) {
			const rig = rigFor(`/assets/${name}-AAAABBBB.png`);
			expect(rig, name).not.toBeNull();
			if (!rig) continue;
			expect(rig.eyeL.y, name).toBeLessThan(rig.mouth.y);
			expect(rig.eyeR.y, name).toBeLessThan(rig.mouth.y);
			expect(rig.eyeL.x, name).toBeLessThan(rig.eyeR.x);
			expect(rig.mouth.x, name).toBeGreaterThan(0.3);
			expect(rig.mouth.x, name).toBeLessThan(0.7);
		}
	});
});

describe("rig 呈现器的接线", () => {
	it("已注册但不在生产策略链里（仍是 realistic → static）", () => {
		expect(PRESENTERS.rig.kind).toBe("rig");
		expect(PRESENTATION_CHAIN).toEqual(["realistic", "static"]);
	});

	it("build 是纯函数：同一输入同一负载", () => {
		const a = PRESENTERS.rig.build(WANG, NEUTRAL) as RigAvatarPayload;
		const b = PRESENTERS.rig.build(WANG, NEUTRAL) as RigAvatarPayload;
		expect(a).toEqual(b);
		expect(a.src).toContain("case-chest-pain-elder-male");
	});

	it("减弱动态 → 静态图，不启动逐帧绘制", () => {
		const payload = PRESENTERS.rig.build(WANG, NEUTRAL);
		if (!payload) throw new Error("负载缺失");
		const { container } = render(<PatientPresenter presentation={payload} fill reducedMotion />);
		expect(container.querySelector("[data-rig-avatar]")).toBeNull();
		expect(container.querySelectorAll("img")).toHaveLength(1);
		cleanup();
	});

	it("没有 rig 的图片退化为静态图，不抛错", () => {
		const payload: RigAvatarPayload = {
			kind: "rig",
			src: "https://cdn.example.com/custom-portrait.png",
			alt: "患者",
			profile: profileFor("neutral"),
		};
		const { container } = render(<PatientPresenter presentation={payload} fill />);
		expect(container.querySelectorAll("img")).toHaveLength(1);
		cleanup();
	});
});
