import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import PremiumFaceArtwork from "../face/PremiumFaceArtwork";
import type { PatientPresentation } from "./types";

/**
 * PatientPresenter — 表现渲染器：按 presentation.kind 分发到具体渲染。
 * 新增表现（如 video-loop）：在 RENDERERS 注册一个渲染函数即可，
 * 上游 build.ts 与业务组件无需改动。
 */

interface RenderCtx {
	p: PatientPresentation;
	size: number;
	/** 圆角风格：full 用于小圆头像，2xl 用于大脸卡片。 */
	rounded: "full" | "2xl";
	className?: string;
}

function renderImage(p: PatientPresentation, ctx: Omit<RenderCtx, "p">) {
	if (p.kind !== "image" && p.kind !== "png-variant") return null;
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

const RENDERERS: Record<PatientPresentation["kind"], (ctx: RenderCtx) => ReactNode> = {
	image: ({ p, ...rest }) => renderImage(p, rest),
	"png-variant": ({ p, ...rest }) => renderImage(p, rest),
	svg: ({ p, size }) => {
		if (p.kind !== "svg") return null;
		return <PremiumFaceArtwork cfg={p.cfg} extras={p.extras} appearance={p.appearance} size={size} />;
	},
};

export default function PatientPresenter({
	presentation,
	size,
	rounded = "2xl",
	className,
}: {
	presentation: PatientPresentation;
	size: number;
	rounded?: "full" | "2xl";
	className?: string;
}) {
	const render = RENDERERS[presentation.kind];
	return render({ p: presentation, size, rounded, className });
}
