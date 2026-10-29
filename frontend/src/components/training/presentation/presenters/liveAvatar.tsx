import type { CSSProperties } from "react";
import { getEmotionBorder, type EmotionState } from "@/stores/trainingStore";
import type {
	EmotionSnapshot,
	LiveAvatarPayload,
	PatientIdentity,
	PatientPresenter,
	PresentationContext,
} from "../types";
import { avatarShapeStyle, renderAvatarImage, resolvePatientPortrait } from "./shared";

/**
 * live — 单张立绘的 2D 动效（M1，独立陈列台上验证；生产链尚未接线）。
 *
 * 能做什么被素材限死：PNG 是整张抠图，没有分层、没有眼嘴遮罩，TTS 也没有 viseme。已落地的只有
 *   - 呼吸：整图亚像素起伏，任何立绘都能做；
 *   - 说话点头：整图轻微前后位移 + 旋转，幅度按情绪调制，并随音频包络略增。
 *
 * 口部开合（P2）2026-10-30 实测后**关掉**：用 `mask-image` 羽化 + 复制层 `scaleY` 的做法，
 * 在写实照片上嘴唇会被拉出双重轮廓、在扁平插画上几乎看不出来——是"纸片被拉伸"而不是张嘴。
 * 原因是单张图里嘴唇与皮肤连在一起，纵向拉伸只能复制纹理，不能产生口腔的暗区。
 * 要真做口型必须先把立绘拆成"嘴部层"（美术），或换音频驱动视频（见 docs/ops/voice-avatar-next.md）。
 * 眨眼（P3）同样需要眼区素材，一并搁置。
 */

/** 情绪 → 呼吸节奏与点头幅度：只调制"在场节奏"，不改情绪语义。 */
const MOTION_BY_EMOTION: Record<EmotionState, { breathSeconds: number; nodScale: number }> = {
	withdrawn: { breathSeconds: 4.2, nodScale: 0.35 },
	defensive: { breathSeconds: 3.4, nodScale: 0.5 },
	anxious: { breathSeconds: 2.4, nodScale: 1 },
	neutral: { breathSeconds: 3.2, nodScale: 0.7 },
	relaxed: { breathSeconds: 3.6, nodScale: 0.6 },
	open: { breathSeconds: 3, nodScale: 0.85 },
};

/** 纯函数：身份 + 情绪快照 → live 负载（选图复用 `resolvePatientPortrait`）。 */
export function buildLiveAvatarPayload(
	patient: PatientIdentity | null,
	emotion: EmotionSnapshot,
): LiveAvatarPayload {
	const portrait = resolvePatientPortrait(patient, emotion);
	const motion = MOTION_BY_EMOTION[emotion.emotion] ?? MOTION_BY_EMOTION.neutral;
	return {
		kind: "live",
		src: portrait.src,
		alt: portrait.alt,
		accent: getEmotionBorder(emotion.emotion),
		breathSeconds: motion.breathSeconds,
		nodScale: motion.nodScale,
	};
}

function LiveAvatarImage({ payload, ctx }: { payload: LiveAvatarPayload; ctx: PresentationContext }) {
	const env = ctx.speaking ? Math.min(1, Math.max(0, ctx.envelope ?? 0)) : 0;
	// 包络只调点头幅度：说话响一些，头动得明显一些；句间静默时收回到基线。
	const nodScale = payload.nodScale * (0.55 + 0.45 * env);
	const sizeStyle: CSSProperties = ctx.fill
		? { width: "100%", aspectRatio: "1 / 1" }
		: { width: ctx.size, height: ctx.size };
	const layerStyle: CSSProperties = {
		position: "absolute",
		inset: 0,
		width: "100%",
		height: "100%",
		objectFit: "cover",
	};

	return (
		<div
			data-live-avatar
			data-speaking={ctx.speaking ? "true" : "false"}
			className={ctx.className}
			style={{
				...avatarShapeStyle(ctx),
				...sizeStyle,
				position: "relative",
				overflow: "hidden",
			}}
		>
			{/* 情绪底光：只做"在场色"，不参与信息表达（情绪文案仍由 EmotionIndicator 承担）。 */}
			<div
				aria-hidden
				style={{
					position: "absolute",
					inset: 0,
					background: `radial-gradient(65% 45% at 50% 100%, ${payload.accent} 0%, transparent 72%)`,
					opacity: 0.28,
					pointerEvents: "none",
				}}
			/>
			<div
				className="patient-live-breath"
				style={{ position: "absolute", inset: 0, animationDuration: `${payload.breathSeconds}s` }}
			>
				<div
					className={ctx.speaking ? "patient-live-nod" : undefined}
					style={
						{
							position: "absolute",
							inset: 0,
							// 点头幅度按情绪 + 包络调制；CSS keyframes 通过自定义属性取值
							"--nod-scale": nodScale,
						} as CSSProperties
					}
				>
					<img src={payload.src} alt={payload.alt} style={layerStyle} draggable={false} />
				</div>
			</div>
		</div>
	);
}

export const liveAvatarPresenter: PatientPresenter = {
	kind: "live",
	build: buildLiveAvatarPayload,
	render(payload, ctx) {
		if (payload.kind !== "live") return null;
		if (ctx.reducedMotion) return renderAvatarImage(payload, ctx);
		return <LiveAvatarImage payload={payload} ctx={ctx} />;
	},
};
