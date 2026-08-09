import type { ReactNode } from "react";
import type { Emotion4DLabel, EmotionState } from "@/stores/trainingStore";
import type { AppearanceProfile } from "../face/appearance";
import type { EmotionValues, FaceConfig } from "../face/expressionMap";
import type { PremiumExtras } from "../face/premiumExtras";

/**
 * 患者表现层 — 情绪数据 → 表现的分离抽象（技术栈分叉点）。
 *
 * 分层职责：
 *   - 输入契约（本文件）：情绪快照 + 患者身份，来自 trainingStore / SSE，二者正交。
 *   - 策略（presenters/）：每个策略一个模块，同一范式 { kind, build, render }；
 *     build 是纯函数（快照+身份 → 负载或 null），render 只做展示。
 *   - 路由（build.ts）：策略链顺序即优先级，null = 不适用 → 交给下一策略；
 *     链必须终止于恒适用策略（static），保证永不落空。
 *   - 分发（PatientPresenter / registry）：按 kind 查注册表渲染，新增策略零业务改动。
 *
 * 已落地策略：
 *   - static       简洁画风 PNG 路由器（按年龄/性别）— 恒适用，链兜底
 *   - realistic    写实画风专属病例头像路由器（按患者姓名）— 未命中让位
 *   - png-variant  情绪 PNG 变体路由器（patient-portrait）— 保留恢复能力
 *   - svg          参数化 SVG 动态渲染器（PremiumFaceArtwork）— 保留恢复能力
 *   - video        视频调度器（预留：AI 生成视频按情绪剪切切换，无源时回退）
 */

/** 情绪快照 — 表现层的唯一输入契约。 */
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

/** 渲染上下文 — 表现无关的展示参数，render 阶段消费。 */
export interface PresentationContext {
	/** 定尺寸渲染时的边长；fill 铺满容器宽时忽略。 */
	size?: number;
	/** 圆角风格：full 用于小圆头像，2xl 用于大脸卡片。 */
	rounded?: "full" | "2xl";
	/** 铺满容器宽（w-full + 正方形）而非固定 size；用于大脸自适应侧边组件宽度。 */
	fill?: boolean;
	className?: string;
}

/** 表现负载 — 各策略产出的可渲染数据（判别联合，消费端可获得类型收窄）。 */
export type PatientPresentation =
	| { kind: "static"; src: string; alt: string }
	| { kind: "realistic"; src: string; alt: string }
	| { kind: "png-variant"; src: string; alt: string }
	| { kind: "svg"; cfg: FaceConfig; extras: PremiumExtras; appearance: AppearanceProfile }
	| {
			kind: "video";
			alt: string;
			poster: string;
			/** 当前情绪对应的视频段；缺该情绪视频时渲染 poster 兜底。 */
			current: EmotionState;
			sources: Partial<Record<EmotionState, string>>;
	  };

export type PresentationKind = PatientPresentation["kind"];

/** 呈现器协议 — 每个策略的标准化接口。 */
export interface PatientPresenter {
	readonly kind: PresentationKind;
	/** 纯函数：快照 + 身份 → 负载；返回 null 表示本策略不适用，交给链上下一策略。 */
	build(patient: PatientIdentity | null, emotion: EmotionSnapshot): PatientPresentation | null;
	/** 渲染：负载 → ReactNode（实现内部按 kind 收窄）。 */
	render(payload: PatientPresentation, ctx: PresentationContext): ReactNode;
}
