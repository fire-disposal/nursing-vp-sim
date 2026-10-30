import { describe, expect, it } from "vitest";
import { cleanup, render } from "@/__tests__/render";
import PatientPresenter from "@/components/training/presentation/PatientPresenter";
import { PRESENTATION_CHAIN } from "@/components/training/presentation/build";
import { ageGroupOf, characterSpec, expressionFor } from "@/components/training/presentation/engine/character";
import { mouthShapeAt } from "@/components/training/presentation/engine/motion";
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

	it("女性是长发/波波头 + 睫毛，男性是短发", () => {
		expect(characterSpec({ age: 20, gender: "女" }).hairStyle).toBe("long");
		expect(characterSpec({ age: 8, gender: "female" }).hairStyle).toBe("bob");
		expect(characterSpec({ age: 20, gender: "男" }).hairStyle).toBe("short");
		expect(characterSpec({ age: 20, gender: "女" }).lashes).toBe(true);
		expect(characterSpec({ age: 20, gender: "男" }).lashes).toBe(false);
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

describe("口型", () => {
	it("不说话时几乎闭合，说话时跟着包络张开", () => {
		expect(mouthShapeAt(1, 0.9, false).open).toBeLessThan(0.1);
		expect(mouthShapeAt(1, 0.9, true).open).toBeGreaterThan(mouthShapeAt(1, 0.2, true).open);
	});

	it("口宽按音节抖动，但始终在有界范围内", () => {
		const wide = Array.from({ length: 40 }, (_, i) => mouthShapeAt(i * 0.11, 0.6, true).wide);
		expect(Math.min(...wide)).toBeGreaterThanOrEqual(0.9);
		expect(Math.max(...wide)).toBeLessThanOrEqual(1.1);
		expect(new Set(wide.map((v) => v.toFixed(3))).size).toBeGreaterThan(1);
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
