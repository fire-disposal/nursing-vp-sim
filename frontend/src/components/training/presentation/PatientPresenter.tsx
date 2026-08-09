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
	className,
}: {
	presentation: PatientPresentation;
	size: number;
	rounded?: "full" | "2xl";
	className?: string;
}) {
	const ctx: PresentationContext = { size, rounded, className };
	return PRESENTERS[presentation.kind].render(presentation, ctx);
}
