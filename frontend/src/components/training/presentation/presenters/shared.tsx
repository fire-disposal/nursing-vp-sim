import type { CSSProperties } from "react";
import { getBasePatientAvatar, getRealisticPatientAvatar } from "@/utils/avatar";
import type { AvatarArt, EmotionSnapshot, PatientIdentity, PresentationContext } from "../types";

/** 选图结果的唯一表示：谁（src）、叫什么（alt）、什么画风（决定动效锚点）。 */
export interface ResolvedPortrait {
	src: string;
	alt: string;
	art: AvatarArt;
}

/**
 * 选图规则**唯一实现**（realistic / live 共用，static 用同一个末级兜底）：
 *   1. 当前情绪有专属立绘（`patient_info.portrait_states`）→ 用这一张；
 *   2. 否则按患者姓名取论文专属写实 PNG；
 *   3. 都没有 → 按年龄/性别取简洁画风（恒适用）。
 * 情绪立绘是病例作者按写实风格提供的，归入 photo 画风。
 */
export function resolvePatientPortrait(
	patient: PatientIdentity | null,
	emotion: EmotionSnapshot,
): ResolvedPortrait {
	const alt = patient?.name ?? "患者";
	const emotionSrc = patient?.portraitStates?.[emotion.emotion];
	if (emotionSrc) return { src: emotionSrc, alt, art: "photo" };
	const realistic = getRealisticPatientAvatar(patient?.name);
	if (realistic) return { src: realistic, alt, art: "photo" };
	return { src: getBasePatientAvatar(patient), alt, art: "flat" };
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
 * 图片类负载的共享渲染 — static / realistic 共用。
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
