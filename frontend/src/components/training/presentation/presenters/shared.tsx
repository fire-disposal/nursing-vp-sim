import { cn } from "@/lib/utils";
import type { PresentationContext } from "../types";

/**
 * 图片类负载的共享渲染 — static / realistic / png-variant 及视频 poster 兜底共用。
 */
export function renderAvatarImage(
	p: { src: string; alt: string },
	ctx: PresentationContext,
) {
	return (
		<img
			src={p.src}
			alt={p.alt}
			style={{ width: ctx.size, height: ctx.size }}
			className={cn(
				"shrink-0 object-cover bg-muted",
				ctx.rounded === "full" ? "rounded-full ring-1 ring-border" : "rounded-2xl ring-1 ring-border",
				ctx.className,
			)}
		/>
	);
}
