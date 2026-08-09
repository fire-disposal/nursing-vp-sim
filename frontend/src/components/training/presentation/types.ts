import type { Emotion4DLabel, EmotionState } from "@/stores/trainingStore";
import type { AppearanceProfile } from "../face/appearance";
import type { EmotionValues, FaceConfig } from "../face/expressionMap";
import type { PremiumExtras } from "../face/premiumExtras";

/**
 * 患者表现层 — 情绪数据 → 表现的分离抽象（技术栈分叉点）。
 *
 * 上游（不可变契约）：情绪数据快照 + 患者身份，来自 trainingStore / SSE。
 * 下游（可插拔）：PatientPresenter 按 kind 渲染，未来换表现只改
 *   `build.ts` 的模式常量 + 注册新 kind，上游与业务组件零改动。
 *
 * 已落地 kind：
 *   - image       静态头像（论文病例写实 PNG，其余简洁头像）— 当前生产模式
 *   - svg         参数化 SVG 脸（原 PremiumFaceArtwork，保留复活能力）
 *   - png-variant 情绪 PNG 变体切换（patient-portrait，保留恢复能力）
 * 未来 kind（如 video-loop 导播调度）：扩展本 union + build 分支 + renderer 即可。
 */

/** 情绪数据快照 — 表现层的唯一输入契约。 */
export interface EmotionSnapshot {
	/** 6 态情绪（兼容旧情绪头像变体） */
	emotion: EmotionState;
	/** 9 态 4D 权威表现标签 */
	emotion4D: Emotion4DLabel;
	/** 四维数值 0-1（信任/焦虑/烦躁/合作） */
	values: EmotionValues;
}

/** 患者身份 — 决定"是谁"，与"什么情绪"正交。 */
export interface PatientIdentity {
	name: string | null;
	gender: string | null;
	age: number | null;
}

/** 表现协议：情绪快照 + 身份 → 一种可渲染的表现描述。 */
export type PatientPresentation =
	| { kind: "image"; src: string; alt: string }
	| { kind: "svg"; cfg: FaceConfig; extras: PremiumExtras; appearance: AppearanceProfile }
	| { kind: "png-variant"; src: string; alt: string };

/** 表现模式 — 技术栈分叉点：切一个常量即切换整套表现。 */
export type PresentationMode = PatientPresentation["kind"];
