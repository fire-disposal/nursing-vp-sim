import { PRESENTERS } from "./registry";
import type { PatientPresentation, PresentationContext } from "./types";

/**
 * PatientPresenter — 表现渲染器：按 presentation.kind 查注册表分发。
 * 新增策略在 presenters/ 写模块并在 registry 注册即可，本组件无需改动。
 */
export default function PatientPresenter({
	presentation,
	size,
	rounded = "2xl",
	fill,
	className,
}: {
	presentation: PatientPresentation;
	/** 非 fill（定尺寸）时必传；fill 铺满容器宽时忽略。 */
	size?: number;
	rounded?: "full" | "2xl";
	fill?: boolean;
	className?: string;
}) {
	const ctx: PresentationContext = { size, rounded, fill, className };
	return PRESENTERS[presentation.kind].render(presentation, ctx);
}
