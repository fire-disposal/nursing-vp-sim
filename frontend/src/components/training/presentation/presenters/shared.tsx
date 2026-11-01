import type { CSSProperties } from "react";
import { getRealisticPatientAvatar } from "@/utils/avatar";
import type { EmotionSnapshot, PatientIdentity, PresentationContext } from "../types";

/** 选图结果：谁（src）、叫什么（alt）。 */
export interface ResolvedPortrait {
	src: string;
	alt: string;
}

/**
 * 病例照片的**唯一**取法（realistic 策略用）：
 *   1. 当前情绪有专属立绘（`patient_info.portrait_states`）→ 用这一张；
 *   2. 否则按患者姓名取论文专属写实 PNG；
 *   3. 都没有 → null（无照片病例交给链上下一个策略，即程序化绘制）。
 * 情绪立绘是病例作者按写实风格提供的，与论文 PNG 同属"照片"。
 */
export function resolvePatientPortrait(
	patient: PatientIdentity | null,
	emotion: EmotionSnapshot,
): ResolvedPortrait | null {
	const alt = patient?.name ?? "患者";
	const emotionSrc = patient?.portraitStates?.[emotion.emotion];
	if (emotionSrc) return { src: emotionSrc, alt };
	const realistic = getRealisticPatientAvatar(patient?.name);
	return realistic ? { src: realistic, alt } : null;
}

/** 头像/立绘共享的圆角 + 描边 + 底色。 */
export function avatarShapeStyle(ctx: PresentationContext): CSSProperties {
	return {
		flexShrink: 0,
		objectFit: "cover",
		background: "var(--mantine-color-default-hover)",
		borderRadius: ctx.rounded === "full" ? "999px" : "1rem",
		boxShadow: "0 0 0 1px var(--mantine-color-default-border)",
	};
}

/**
 * 图片类负载的共享渲染 — realistic 用。
 */
export function renderAvatarImage(
	p: { src: string; alt: string },
	ctx: PresentationContext,
) {
	const base = avatarShapeStyle(ctx);

	// fill：铺满容器宽（正方形），不设固定尺寸，随侧边组件宽度自适应。
	if (ctx.fill) {
		return (
			<img
				src={p.src}
				alt={p.alt}
				className={ctx.className}
				style={{ width: "100%", aspectRatio: "1 / 1", ...base }}
			/>
		);
	}

	return (
		<img
			src={p.src}
			alt={p.alt}
			className={ctx.className}
			style={{ width: ctx.size, height: ctx.size, ...base }}
		/>
	);
}
