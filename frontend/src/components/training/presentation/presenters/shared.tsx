import { cn } from "@/lib/utils";
import type { PresentationContext } from "../types";

/**
 * 图片类负载的共享渲染 — static / realistic / png-variant 及视频 poster 兜底共用。
 */
export function renderAvatarImage(
	p: { src: string; alt: string },
	ctx: PresentationContext,
) {
	const shape = cn(
		"shrink-0 object-cover bg-muted",
		ctx.rounded === "full" ? "rounded-full ring-1 ring-border" : "rounded-2xl ring-1 ring-border",
		ctx.className,
	);
	// fill：铺满容器宽（正方形），不设固定尺寸，随侧边组件宽度自适应。
	if (ctx.fill) {
		return <img src={p.src} alt={p.alt} className={cn("w-full aspect-square", shape)} />;
	}
	return (
		<img
			src={p.src}
			alt={p.alt}
			style={{ width: ctx.size, height: ctx.size }}
			className={shape}
		/>
	);
}
