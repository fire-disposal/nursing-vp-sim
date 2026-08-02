import type { Emotion4DLabel } from "@/stores/trainingStore";

/**
 * 患者表情配置 — 纯函数映射层（"大脑"）。
 *
 * 输入契约：Emotion4DLabel（后端 resolve_dominant_state 的 9 态标签）
 * + 四维数值（0-1，与 EmotionVector 同量纲）。
 * 输出：SVG 脸可消费的确定性 FaceConfig。
 *
 * 契约冻结规则：新增标签 = 在 LABEL_FACES 加一行（向后兼容）；
 * 修改已有标签的默认值 = 需要评审（会改变所有消费端渲染）。
 */

export type EyeShape = "flat" | "narrow" | "wide" | "curve";

export interface FaceConfig {
	/** 眉毛：-1 下压(怒/防御) .. 0 平 .. 1 上挑(惊恐/焦虑) */
	browAngle: number;
	/** 眼睛开合：0 闭 .. 1 大睁 */
	eyeOpenness: number;
	eyeShape: EyeShape;
	mouth: "smile" | "flat" | "frown" | "tight" | "open";
	blush: boolean;
	tears: boolean;
}

/** 四维情绪数值（0-1）。 */
export interface EmotionValues {
	trust: number;
	anxiety: number;
	irritation: number;
	cooperation: number;
}

export const NEUTRAL_FACE: FaceConfig = {
	browAngle: 0,
	eyeOpenness: 0.55,
	eyeShape: "flat",
	mouth: "flat",
	blush: false,
	tears: false,
};

/** 每个 4D 标签的表情基调（数值修正在其上叠加）。 */
const LABEL_FACES: Record<Emotion4DLabel, Partial<FaceConfig>> = {
	open_trusting: { browAngle: 0.2, eyeOpenness: 0.6, eyeShape: "curve", mouth: "smile" },
	trusting_anxious: { browAngle: 0.45, eyeOpenness: 0.75, eyeShape: "wide", mouth: "tight" },
	irritated: { browAngle: -0.8, eyeOpenness: 0.35, eyeShape: "narrow", mouth: "frown" },
	anxious_cooperative: { browAngle: 0.35, eyeOpenness: 0.7, eyeShape: "wide", mouth: "tight", blush: true },
	anxious_guarded: { browAngle: 0.3, eyeOpenness: 0.6, eyeShape: "wide", mouth: "flat" },
	withdrawn: { browAngle: -0.15, eyeOpenness: 0.25, eyeShape: "flat", mouth: "frown", tears: true },
	defensive: { browAngle: -0.45, eyeOpenness: 0.4, eyeShape: "narrow", mouth: "tight" },
	relaxed: { browAngle: 0.15, eyeOpenness: 0.5, eyeShape: "curve", mouth: "smile", blush: true },
	neutral: {},
};

export function faceConfigFrom4D(label: Emotion4DLabel, v: EmotionValues): FaceConfig {
	const base = LABEL_FACES[label] ?? {};
	const cfg: FaceConfig = { ...NEUTRAL_FACE, ...base };

	// 数值修正：在标签基调之上叠加极值信号，保证可感知
	if (v.irritation >= 0.7) {
		cfg.browAngle = Math.min(cfg.browAngle, -0.6);
	}
	if (v.anxiety >= 0.7) {
		cfg.eyeOpenness = Math.max(cfg.eyeOpenness, 0.65);
	}
	if (v.cooperation <= 0.3 && v.trust <= 0.3) {
		cfg.mouth = "tight";
		cfg.eyeOpenness = Math.min(cfg.eyeOpenness, 0.4);
	}
	return cfg;
}
