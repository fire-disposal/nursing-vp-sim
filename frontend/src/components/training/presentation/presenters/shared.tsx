import type { CSSProperties } from "react";
import type { PresentationContext } from "../types";

/** 头像/立绘共享的圆角 + 描边 + 底色。 */
export function avatarShapeStyle(ctx: PresentationContext): CSSProperties {
	return {
		flexShrink: 0,
		objectFit: "cover",
		background: "var(--mantine-color-gray-2)",
		borderRadius: ctx.rounded === "full" ? "999px" : "1rem",
		boxShadow: "0 0 0 1px var(--mantine-color-default-border)",
	};
}

/**
 * 图片类负载的共享渲染 — static / realistic / png-variant 及视频 poster 兜底共用。
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
