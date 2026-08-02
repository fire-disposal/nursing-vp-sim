/**
 * 外观模型 — 性别 × 年龄的基础脸参数（静态，独立于情绪）。
 *
 * 防膨胀原则：外观是"基础脸"，情绪是"叠加变形"——二者正交，
 * 不产生 外观×情绪 的笛卡尔积。6 个基础外观（2 性别 × 3 年龄组），
 * 9 种情绪在任何外观上都可叠加。
 *
 * 头发是男女老少适配的最大杠杆：发型分性别，发色灰白化分年龄。
 */

export type Gender = "female" | "male";
export type AgeGroup = "child" | "young" | "middle" | "elderly";
export type HairStyle = "short" | "long" | "longSide" | "bun" | "pigtails" | "receding";

export interface AppearanceProfile {
	gender: Gender;
	ageGroup: AgeGroup;
	hairStyle: HairStyle;
	/** 白发比例 0..1 — 驱动发色渐变灰化 */
	hairGrays: number;
	/** 脸型：年轻圆润 / 女性柔和 / 男性方正 */
	faceShape: "round" | "oval" | "square";
	/** 眉毛粗细倍率（男性更粗） */
	browWeight: number;
	/** 女性睫毛 */
	lashes: boolean;
	/** 唇部丰满度（女性更饱满） */
	lipFullness: number;
	/** 皱纹级别 0 无 / 1 中年 / 2 老年 */
	wrinkles: 0 | 1 | 2;
	/** 肤色哑光度 0..1（老年偏哑黄） */
	skinMuted: number;
}

/**
 * 年龄阶段 — 对齐系统权威四阶段（infra/tts/mapper.py 声位槽）：
 *   child ≤12 / young 13-25 / middle 26-59 / elderly ≥60
 */
export function ageGroupFor(age: number): AgeGroup {
	if (age <= 12) return "child";
	if (age <= 25) return "young";
	if (age <= 59) return "middle";
	return "elderly";
}

const PRESETS: Record<`${Gender}-${AgeGroup}`, AppearanceProfile> = {
	"female-child": {
		gender: "female",
		ageGroup: "child",
		hairStyle: "pigtails",
		hairGrays: 0,
		faceShape: "round",
		browWeight: 1,
		lashes: true,
		lipFullness: 1.15,
		wrinkles: 0,
		skinMuted: 0,
	},
	"male-child": {
		gender: "male",
		ageGroup: "child",
		hairStyle: "short",
		hairGrays: 0,
		faceShape: "round",
		browWeight: 1.2,
		lashes: false,
		lipFullness: 1.05,
		wrinkles: 0,
		skinMuted: 0,
	},
	"female-young": {
		gender: "female",
		ageGroup: "young",
		hairStyle: "long",
		hairGrays: 0,
		faceShape: "round",
		browWeight: 1,
		lashes: true,
		lipFullness: 1.12,
		wrinkles: 0,
		skinMuted: 0,
	},
	"female-middle": {
		gender: "female",
		ageGroup: "middle",
		hairStyle: "longSide",
		hairGrays: 0.25,
		faceShape: "oval",
		browWeight: 1,
		lashes: true,
		lipFullness: 1.1,
		wrinkles: 1,
		skinMuted: 0.3,
	},
	"female-elderly": {
		gender: "female",
		ageGroup: "elderly",
		hairStyle: "bun",
		hairGrays: 0.9,
		faceShape: "oval",
		browWeight: 1,
		lashes: true,
		lipFullness: 1,
		wrinkles: 2,
		skinMuted: 0.55,
	},
	"male-young": {
		gender: "male",
		ageGroup: "young",
		hairStyle: "short",
		hairGrays: 0,
		faceShape: "round",
		browWeight: 1.35,
		lashes: false,
		lipFullness: 1,
		wrinkles: 0,
		skinMuted: 0,
	},
	"male-middle": {
		gender: "male",
		ageGroup: "middle",
		hairStyle: "short",
		hairGrays: 0.3,
		faceShape: "square",
		browWeight: 1.35,
		lashes: false,
		lipFullness: 1,
		wrinkles: 1,
		skinMuted: 0.3,
	},
	"male-elderly": {
		gender: "male",
		ageGroup: "elderly",
		hairStyle: "receding",
		hairGrays: 0.95,
		faceShape: "square",
		browWeight: 1.35,
		lashes: false,
		lipFullness: 1,
		wrinkles: 2,
		skinMuted: 0.55,
	},
};

export function appearanceFor(gender: Gender, ageGroup: AgeGroup): AppearanceProfile {
	return PRESETS[`${gender}-${ageGroup}`];
}

/**
 * 从患者真实数据解析外观 — 兼容匿名/盲盒（age≤0 或缺失 → 默认青年，不落入 child）。
 * 与 TTS 声位选择（resolve_voice_type）同构：年龄 + 性别 → 档位。
 */
export function appearanceForPatient(age: number | null | undefined, gender: string | null | undefined): AppearanceProfile {
	const g: Gender = gender === "male" ? "male" : "female";
	const validAge = typeof age === "number" && Number.isFinite(age) && age > 0;
	return appearanceFor(g, validAge ? ageGroupFor(age) : "young");
}

/** 颜色混合 — 灰白发/哑光皮肤的颜色插值基础工具。 */
export function mixHex(a: string, b: string, t: number): string {
	const pa = Number.parseInt(a.slice(1), 16);
	const pb = Number.parseInt(b.slice(1), 16);
	const mix = (shift: number) =>
		Math.round(((pa >> shift) & 0xff) * (1 - t) + ((pb >> shift) & 0xff) * t);
	const r = mix(16);
	const g = mix(8);
	const bl = mix(0);
	return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}
