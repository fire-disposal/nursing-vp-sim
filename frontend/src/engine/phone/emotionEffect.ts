import type { PhoneCharacter } from "./characters";
import { applyDelta, drift } from "./emotion";
import type { ScriptIntent } from "./types";
import type { EmotionVector } from "./types";

/**
 * 情绪效应 —— 用户的一句话对四维向量做了什么。
 *
 * 这是**本地**的判定：后端只负责"这位角色怎么说话"，情绪的物理量在这里算，
 * 因此演示页能即时给出数值反馈（不必等模型回完），也就不需要在后端再维护一份状态。
 *
 * 意图由 `classifyUserText` 的正则给出（问候/共情/情绪询问/提问/其他），
 * 再叠两个与角色脾气相关的因子：
 *   1. 打断（学生在对方说到一半时开口）→ 烦躁涨、配合掉；
 *   2. 脾气敏感度：初始烦躁高的人被共情时松动得慢、被冷落时炸得快。
 */

export interface EmotionEffect {
	intent: ScriptIntent;
	interrupted: boolean;
}

const INTENT_DELTAS: Record<ScriptIntent, Partial<EmotionVector>> = {
	greeting: { trust: 0.04, irritation: -0.03, cooperation: 0.03 },
	emotion_probe: { trust: 0.07, anxiety: -0.04, irritation: -0.02, cooperation: 0.04 },
	empathy: { trust: 0.12, anxiety: -0.09, irritation: -0.1, cooperation: 0.07 },
	question: { trust: 0.03, cooperation: 0.05, anxiety: -0.02 },
	other: { trust: 0.01, irritation: 0.01 },
};

const INTERRUPT_DELTA: Partial<EmotionVector> = { irritation: 0.07, cooperation: -0.05, trust: -0.02 };

/** 0.8（好脾气）..1.2（一点就着）：由初始烦躁度决定。 */
function temperFactor(character: PhoneCharacter): number {
	return 0.8 + character.initial.irritation;
}

export function applyEmotionEffect(
	emotion: EmotionVector,
	character: PhoneCharacter,
	effect: EmotionEffect,
): EmotionVector {
	const temper = temperFactor(character);
	const delta: Partial<EmotionVector> = {};
	for (const [dim, value] of Object.entries(INTENT_DELTAS[effect.intent]) as Array<
		[keyof EmotionVector, number]
	>) {
		// 负面维度按脾气放大；正面维度按脾气缩小（爆脾气的人不容易被说服）。
		delta[dim] = dim === "trust" || dim === "cooperation" ? value / temper : value * temper;
	}
	if (effect.interrupted) {
		delta.irritation = (delta.irritation ?? 0) + INTERRUPT_DELTA.irritation! * temper;
		delta.cooperation = (delta.cooperation ?? 0) + INTERRUPT_DELTA.cooperation!;
		delta.trust = (delta.trust ?? 0) + INTERRUPT_DELTA.trust!;
	}
	// 每轮一点点自然回弹：通话越到后面越接近这个人本来的状态。
	return drift(applyDelta(emotion, delta), character.initial, 0.02);
}
