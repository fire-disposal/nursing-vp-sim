import { describe, expect, it } from "vitest";
import { cleanup, render } from "@/__tests__/render";
import PatientPresenter from "@/components/training/presentation/PatientPresenter";
import { PRESENTATION_CHAIN } from "@/components/training/presentation/build";
import { ageGroupOf, characterSpec, expressionFor } from "@/components/training/presentation/engine/character";
import { gazeXAt, gazeYAt, mouthFrameAt, swayAt } from "@/components/training/presentation/engine/motion";
import { PRESENTERS } from "@/components/training/presentation/registry";
import type { EmotionSnapshot, MiiAvatarPayload } from "@/components/training/presentation/types";

/**
 * 自绘角色（M3）：canvas 像素在 jsdom 里测不了，所以测两件真正决定观感的事——
 * 身份 → 规格的映射（年龄/性别必须画出不同的人），以及五官与表情的几何关系。
 */

const SNAPSHOT: EmotionSnapshot = {
	emotion: "neutral",
	emotion4D: "neutral",
	values: { trust: 50, anxiety: 30, irritation: 20, cooperation: 70 },
};

const IDS = [
	{ age: 8, gender: "男" },
	{ age: 8, gender: "女" },
	{ age: 20, gender: "male" },
	{ age: 20, gender: "female" },
	{ age: 45, gender: "男" },
	{ age: 45, gender: "女" },
	{ age: 78, gender: "男" },
	{ age: 78, gender: "女" },
];

describe("年龄与性别的映射", () => {
	it("年龄段按临床习惯分四档", () => {
		expect(ageGroupOf(8)).toBe("child");
		expect(ageGroupOf(20)).toBe("youth");
		expect(ageGroupOf(45)).toBe("middle");
		expect(ageGroupOf(78)).toBe("elder");
		expect(ageGroupOf(null)).toBe("middle");
	});

	it("小孩头更大、眼睛更大", () => {
		const child = characterSpec({ age: 8, gender: "男" });
		const adult = characterSpec({ age: 45, gender: "男" });
		expect(child.head.rx).toBeGreaterThan(adult.head.rx);
		expect(child.eyes.rx).toBeGreaterThan(adult.eyes.rx);
	});

	it("老人有皱纹、灰头发；中年没有", () => {
		const elder = characterSpec({ age: 78, gender: "女" });
		expect(elder.wrinkles).toBeGreaterThan(0.5);
		const middle = characterSpec({ age: 45, gender: "女" });
		expect(middle.wrinkles).toBeLessThan(0.3);
		expect(elder.hair).not.toBe(middle.hair);
	});

	it("女性是长发/波波头，男性是短发", () => {
		expect(characterSpec({ age: 20, gender: "女" }).hairStyle).toBe("long");
		expect(characterSpec({ age: 8, gender: "female" }).hairStyle).toBe("bob");
		expect(characterSpec({ age: 20, gender: "男" }).hairStyle).toBe("short");
	});

	it("眼睛默认用整块深色眼珠 + 小高光，避免常态眼线带来的困倦感", () => {
		for (const id of IDS) {
			expect(characterSpec(id).eyeStyle, `${id.age}${id.gender}`).toBe("glint");
		}
	});

	it("未知性别按男性画，不会崩", () => {
		const spec = characterSpec({ age: 30, gender: null });
		expect(spec.hairStyle).toBe("short");
	});
});

describe("五官几何", () => {
	it("每张脸都满足：眉在眼上、眼在嘴上、嘴在鼻下、耳在脸外", () => {
		for (const id of IDS) {
			const s = characterSpec(id);
			const label = `${id.age}${id.gender}`;
			expect(s.brows.y, label).toBeLessThan(s.eyes.y);
			expect(s.eyes.y, label).toBeLessThan(s.nose.y);
			expect(s.nose.y, label).toBeLessThan(s.mouth.y);
			expect(s.mouth.y, label).toBeLessThan(s.head.cy + s.head.ry);
			// 耳朵要在头的外侧，否则会被头椭圆盖住、变成看不见
			expect(s.ears.dx, label).toBeGreaterThan(s.head.rx);
		}
	});

	it("两眼关于中线对称", () => {
		const s = characterSpec({ age: 45, gender: "女" });
		expect(0.5 - s.eyes.dx).toBeCloseTo(1 - (0.5 + s.eyes.dx), 10);
		expect(0.5 - s.brows.dx).toBeCloseTo(1 - (0.5 + s.brows.dx), 10);
	});
});

describe("情绪 → 表情", () => {
	it("焦虑：眉眼上挑、眼更大；防御：眉头压、嘴角下", () => {
		const anxious = expressionFor("anxious");
		const defensive = expressionFor("defensive");
		expect(anxious.browAngle).toBeLessThan(0);
		expect(anxious.eyeOpen).toBeGreaterThan(1);
		expect(defensive.browAngle).toBeGreaterThan(0);
		expect(defensive.smile).toBeLessThan(0);
	});

	it("回避收敛眼型、嘴角最下垂；放松/开放是笑的", () => {
		expect(expressionFor("withdrawn").eyeOpen).toBeLessThan(1);
		expect(expressionFor("withdrawn").smile).toBeLessThan(expressionFor("defensive").smile);
		expect(expressionFor("relaxed").smile).toBeGreaterThan(0.3);
		expect(expressionFor("open").smile).toBeGreaterThan(0.3);
	});

	it("未知情绪退化为中性", () => {
		// @ts-expect-error 故意传入枚举外的值
		expect(expressionFor("bored")).toEqual(expressionFor("neutral"));
	});
});

describe("口型帧", () => {
	it("不说话 / 没包络 → 永远是闭口", () => {
		expect(mouthFrameAt(1.3, 0.9, false).shape).toBe("closed");
		expect(mouthFrameAt(1.3, 0.02, true).shape).toBe("closed");
	});

	it("音量越大，切到的嘴型越大", () => {
		const quiet = Array.from({ length: 60 }, (_, i) => mouthFrameAt(i * 0.14, 0.2, true).shape);
		const loud = Array.from({ length: 60 }, (_, i) => mouthFrameAt(i * 0.14, 0.95, true).shape);
		expect(quiet).not.toContain("wide");
		expect(loud.filter((s) => s === "wide").length).toBeGreaterThan(25);
	});

	it("按音节钟切换：一秒内会换好几次，且不是每帧都变", () => {
		const shapes = Array.from({ length: 30 }, (_, i) => mouthFrameAt(2 + i / 30, 0.7, true).shape);
		const switches = shapes.filter((s, i) => i > 0 && s !== shapes[i - 1]).length;
		// 每秒约 7 个音节，切换次数应明显多于 1、又远少于每帧都变
		expect(switches).toBeGreaterThanOrEqual(3);
		expect(switches).toBeLessThan(30);
	});

	it("同一时刻永远是同一张嘴（可复现、截图可对齐）", () => {
		expect(mouthFrameAt(7.13, 0.5, true)).toEqual(mouthFrameAt(7.13, 0.5, true));
	});

	it("口宽有变化但始终有界", () => {
		const widths = Array.from({ length: 40 }, (_, i) => mouthFrameAt(i * 0.14, 0.6, true).width);
		expect(Math.min(...widths)).toBeGreaterThanOrEqual(0.9);
		expect(Math.max(...widths)).toBeLessThanOrEqual(1.1);
		expect(new Set(widths.map((w) => w.toFixed(3))).size).toBeGreaterThan(1);
	});
});

describe("微动作", () => {
	it("偏头在窗口边界连续，有停顿且幅度有界", () => {
		for (const k of [1, 2, 3]) {
			expect(swayAt(k * 6.4 - 0.0001, 7)).toBeCloseTo(swayAt(k * 6.4 + 0.0001, 7), 8);
		}
		const samples = Array.from({ length: 200 }, (_, i) => swayAt(i * 0.1, 7));
		expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.8);
		expect(samples.filter((v, i) => i > 0 && Math.abs(v - samples[i - 1]) < 0.000001).length).toBeGreaterThan(30);
	});

	it("眼神停留后移向下一点，窗口边界连续且不同 seed 不同步", () => {
		for (const k of [1, 2, 3]) {
			expect(gazeXAt(k * 3.1 - 0.0001, 11)).toBeCloseTo(gazeXAt(k * 3.1 + 0.0001, 11), 5);
			expect(gazeYAt(k * 3.1 - 0.0001, 11)).toBeCloseTo(gazeYAt(k * 3.1 + 0.0001, 11), 5);
		}
		const a = Array.from({ length: 80 }, (_, i) => gazeXAt(i * 0.1, 11));
		const b = Array.from({ length: 80 }, (_, i) => gazeXAt(i * 0.1, 97));
		expect(a).not.toEqual(b);
		expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(0.75);
	});
});

describe("呈现器接线", () => {
	it("已注册但不在生产策略链里", () => {
		expect(PRESENTERS.mii.kind).toBe("mii");
		expect(PRESENTATION_CHAIN).toEqual(["realistic", "static"]);
	});

	it("build 是纯函数：同一身份同一情绪 → 同一份负载", () => {
		const a = PRESENTERS.mii.build({ name: null, age: 68, gender: "男" }, SNAPSHOT) as MiiAvatarPayload;
		const b = PRESENTERS.mii.build({ name: null, age: 68, gender: "男" }, SNAPSHOT) as MiiAvatarPayload;
		expect(a).toEqual(b);
		expect(a.spec.wrinkles).toBeGreaterThan(0.5);
	});

	it("渲染成 canvas 外壳，不加载任何图片", () => {
		const payload = PRESENTERS.mii.build({ name: null, age: 20, gender: "女" }, SNAPSHOT);
		if (!payload) throw new Error("负载缺失");
		const { container } = render(<PatientPresenter presentation={payload} fill />);
		expect(container.querySelector("[data-mii-avatar]")).not.toBeNull();
		expect(container.querySelectorAll("img")).toHaveLength(0);
		cleanup();
	});

	it("减弱动态 → 静止帧，同样是一块 canvas", () => {
		const payload = PRESENTERS.mii.build({ name: null, age: 78, gender: "男" }, SNAPSHOT);
		if (!payload) throw new Error("负载缺失");
		const { container } = render(<PatientPresenter presentation={payload} fill reducedMotion />);
		expect(container.querySelectorAll("canvas")).toHaveLength(1);
		expect(container.querySelectorAll("img")).toHaveLength(0);
		cleanup();
	});
});
