/**
 * 角色规格 — 「画出来的人」的全部可变量：配色、比例、发型、表情。
 *
 * 这里是纯函数：年龄 + 性别 + 情绪 → 一份可以逐帧重复绘制的数据，不含时间、不碰 canvas。
 * 风格参照任天堂 Mii / 动森那一类：大头、圆脸、两点眼、极简嘴，靠比例和颜色区分人，
 * 不靠贴图——所以也就没有任何 PNG 依赖。
 */

import type { EmotionState } from "@/stores/trainingStore";

export type AgeGroup = "child" | "youth" | "middle" | "elder";
export type HairStyle = "short" | "bob" | "long";

/** 身份（与情绪正交）：决定长相。 */
export interface CharacterIdentity {
	age: number | null;
	/** 后端存的是「男/女」，也兼容 male/female。 */
	gender: string | null;
}

export interface CharacterSpec {
	skin: string;
	skinShade: string;
	hair: string;
	hairShade: string;
	cloth: string;
	clothShade: string;
	collar: string;
	blush: string;
	head: { cy: number; rx: number; ry: number };
	eyes: { y: number; dx: number; rx: number; ry: number };
	brows: { y: number; dx: number; w: number; thick: number };
	nose: { y: number; w: number };
	mouth: { y: number; w: number };
	ears: { y: number; dx: number; rx: number; ry: number };
	neck: { w: number; top: number };
	body: { top: number; w: number };
	hairStyle: HairStyle;
	/** 0..1：额头纹与法令纹的浓淡。 */
	wrinkles: number;
	lashes: boolean;
}

/** 情绪 → 表情参数（纯数值，绘制时消费）。 */
export interface Expression {
	/** 眉毛倾角（度，正 = 眉内侧压低 = 恼怒）。 */
	browAngle: number;
	/** 眉毛整体上提（-1..1）。 */
	browRaise: number;
	/** 眼睛开合倍率（1 = 常态）。 */
	eyeOpen: number;
	/** 嘴角 -1（下垂）..1（上扬）。 */
	smile: number;
	/** 腮红浓度 0..1。 */
	blush: number;
	/** 嘴宽倍率。 */
	mouthWidth: number;
}

const PALETTE = {
	skin: "#f7d3ae",
	skinShade: "#efc39c",
	blush: "#f2a08f",
	cloth: "#d6e6f7",
	clothShade: "#bcd3ea",
	collar: "#fbfdff",
} as const;

const HAIR: Record<AgeGroup, { main: string; shade: string }> = {
	child: { main: "#3a2a21", shade: "#241813" },
	youth: { main: "#332720", shade: "#1f1712" },
	middle: { main: "#3d2f26", shade: "#251a14" },
	elder: { main: "#d5d2d0", shade: "#b3b0ae" },
};

export function ageGroupOf(age: number | null | undefined): AgeGroup {
	if (age == null || age <= 0) return "middle";
	if (age <= 12) return "child";
	if (age <= 25) return "youth";
	if (age < 60) return "middle";
	return "elder";
}

function isFemale(gender: string | null | undefined): boolean {
	return gender === "女" || gender === "female";
}

/**
 * 年龄决定「脸的成熟度」，性别决定发型与眉形。所有数字都是画面比例，
 * 想要调节某个年龄更像小孩/更像老人，改这里的几个系数即可。
 */
export function characterSpec(identity: CharacterIdentity): CharacterSpec {
	const group = ageGroupOf(identity.age);
	const female = isFemale(identity.gender);
	const hair = HAIR[group];

	// 小孩头更大更圆、眼睛更大；老人脸略窄、眼略小、加皱纹
	const headScale = group === "child" ? 1.08 : group === "elder" ? 0.97 : 1;
	const eyeScale = group === "child" ? 1.22 : group === "elder" ? 0.92 : 1;
	const wrinkles = group === "elder" ? 0.85 : group === "middle" ? 0.18 : 0;

	const head = { cy: 0.4, rx: 0.235 * headScale, ry: 0.265 * headScale };

	return {
		skin: PALETTE.skin,
		skinShade: PALETTE.skinShade,
		hair: hair.main,
		hairShade: hair.shade,
		cloth: PALETTE.cloth,
		clothShade: PALETTE.clothShade,
		collar: PALETTE.collar,
		blush: PALETTE.blush,
		head,
		eyes: { y: 0.42, dx: 0.099, rx: 0.043 * eyeScale, ry: 0.053 * eyeScale },
		brows: { y: 0.352, dx: 0.099, w: 0.068, thick: female ? 0.011 : 0.013 },
		nose: { y: 0.492, w: 0.03 },
		mouth: { y: 0.562, w: 0.086 * (group === "child" ? 0.92 : 1) },
		// 耳朵必须落在头外侧，否则会被头椭圆盖住（头大小随年龄变，这里跟着推）
		ears: { y: 0.432, dx: head.rx * 1.06, rx: 0.032, ry: 0.046 },
		neck: { w: 0.13, top: 0.646 },
		body: { top: 0.715, w: 0.76 },
		hairStyle: female ? (group === "child" ? "bob" : "long") : "short",
		wrinkles,
		lashes: female,
	};
}

const EXPRESSIONS: Record<EmotionState, Expression> = {
	neutral: { browAngle: 0, browRaise: 0, eyeOpen: 1, smile: 0.12, blush: 0.18, mouthWidth: 1 },
	relaxed: { browAngle: -2, browRaise: 0.1, eyeOpen: 0.94, smile: 0.5, blush: 0.3, mouthWidth: 1.02 },
	open: { browAngle: -3, browRaise: 0.25, eyeOpen: 1.04, smile: 0.6, blush: 0.42, mouthWidth: 1.06 },
	anxious: { browAngle: -9, browRaise: 0.45, eyeOpen: 1.14, smile: -0.08, blush: 0.2, mouthWidth: 0.94 },
	defensive: { browAngle: 9, browRaise: 0.3, eyeOpen: 0.9, smile: -0.36, blush: 0.14, mouthWidth: 0.92 },
	withdrawn: { browAngle: 4, browRaise: -0.3, eyeOpen: 0.8, smile: -0.52, blush: 0.1, mouthWidth: 0.88 },
};

export function expressionFor(emotion: EmotionState): Expression {
	return EXPRESSIONS[emotion] ?? EXPRESSIONS.neutral;
}
