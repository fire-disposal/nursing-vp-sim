import { describe, expect, it } from "vitest";
import { findCharacter } from "@/engine/phone/characters";
import { applyDelta, dominantLabel, drift } from "@/engine/phone/emotion";
import { applyEmotionEffect } from "@/engine/phone/emotionEffect";
import { classifyUserText, truncateForInterrupt } from "@/engine/phone/script";
import type { EmotionVector } from "@/engine/phone/types";

/** 情绪状态机的四条可观测性质：夹取、主导标签、角色差异、打断恶化。 */
const base: EmotionVector = { trust: 0.3, anxiety: 0.4, irritation: 0.3, cooperation: 0.4 };

describe("四维情绪状态机", () => {
	it("applyDelta 夹取到 0..1", () => {
		expect(
			applyDelta({ trust: 0.95, anxiety: 0.05, irritation: 0.5, cooperation: 0.5 }, { trust: 0.4, anxiety: -0.4 }),
		).toEqual({ trust: 1, anxiety: 0, irritation: 0.5, cooperation: 0.5 });
	});

	it("主导标签按固定优先级判定", () => {
		expect(dominantLabel({ trust: 0.1, anxiety: 0.1, irritation: 0.9, cooperation: 0.1 })).toBe("irritated");
		expect(dominantLabel({ trust: 0.2, anxiety: 0.1, irritation: 0.5, cooperation: 0.1 })).toBe("defensive");
		expect(dominantLabel({ trust: 0.15, anxiety: 0.2, irritation: 0.1, cooperation: 0.2 })).toBe("withdrawn");
		expect(dominantLabel({ trust: 0.3, anxiety: 0.8, irritation: 0.1, cooperation: 0.2 })).toBe("anxious_guarded");
		expect(dominantLabel({ trust: 0.4, anxiety: 0.7, irritation: 0.1, cooperation: 0.7 })).toBe("anxious_cooperative");
		expect(dominantLabel({ trust: 0.8, anxiety: 0.6, irritation: 0.1, cooperation: 0.6 })).toBe("trusting_anxious");
		expect(dominantLabel({ trust: 0.9, anxiety: 0.1, irritation: 0.1, cooperation: 0.6 })).toBe("open_trusting");
		expect(dominantLabel({ trust: 0.6, anxiety: 0.2, irritation: 0.1, cooperation: 0.5 })).toBe("relaxed");
		expect(dominantLabel({ trust: 0.4, anxiety: 0.3, irritation: 0.3, cooperation: 0.4 })).toBe("neutral");
	});

	it("drift 向基线回弹但不越界", () => {
		const drifted = drift({ trust: 1, anxiety: 0, irritation: 1, cooperation: 0 }, base, 0.5);
		expect(drifted.trust).toBeLessThan(1);
		expect(drifted.trust).toBeGreaterThan(base.trust);
		expect(drifted.irritation).toBeLessThan(1);
		expect(drifted.irritation).toBeGreaterThan(base.irritation);
	});

	it("共情让状态朝友好方向移动，连续共情会跨到更友好的标签", () => {
		const character = findCharacter("zhou-zhenguo")!;
		let emotion = base;
		const labels: string[] = [];
		for (let i = 0; i < 5; i += 1) {
			const next = applyEmotionEffect(emotion, character, { intent: "empathy", interrupted: false });
			expect(next.trust).toBeGreaterThan(emotion.trust);
			emotion = next;
			labels.push(dominantLabel(emotion));
		}
		expect(labels[0]).not.toBe(labels[labels.length - 1]);
	});

	it("有效打断抬高烦躁、压低配合（相对同文本不打断）", () => {
		const character = findCharacter("lin-wanqing")!;
		const clean = applyEmotionEffect(base, character, { intent: "question", interrupted: false });
		const barged = applyEmotionEffect(base, character, { intent: "question", interrupted: true });
		expect(barged.irritation).toBeGreaterThan(clean.irritation);
		expect(barged.cooperation).toBeLessThan(clean.cooperation);
	});

	it("脾气越炸，同样的共情松动得越慢", () => {
		const calm = applyEmotionEffect(base, findCharacter("su-xiaoman")!, { intent: "empathy", interrupted: false });
		const hot = applyEmotionEffect(base, findCharacter("he-jianfeng")!, { intent: "empathy", interrupted: false });
		expect(hot.trust).toBeLessThan(calm.trust);
	});
});

describe("本地文本工具", () => {
	it("意图判定是纯规则，未命中即 other（不限制输入）", () => {
		expect(classifyUserText("你好呀")).toBe("greeting");
		expect(classifyUserText("你现在心情怎么样？")).toBe("emotion_probe");
		expect(classifyUserText("我理解你的担心")).toBe("empathy");
		expect(classifyUserText("几点见面？")).toBe("question");
		expect(classifyUserText("随便聊聊今天路上的见闻")).toBe("other");
		expect(classifyUserText("")).toBe("other");
	});

	it("打断截断只保留念完的整句", () => {
		expect(truncateForInterrupt("第一句。第二句还没说完", 8)).toBe("第一句。");
		expect(truncateForInterrupt("还在第一句里", 4)).toBe("");
		expect(truncateForInterrupt("短句。", 10)).toBe("短句。");
	});
});
