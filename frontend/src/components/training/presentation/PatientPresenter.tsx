import { useReducedMotion } from "@mantine/hooks";
import { PRESENTERS } from "./registry";
import type { PatientPresentation, PresentationContext } from "./types";

/**
 * PatientPresenter — 表现渲染器：按 presentation.kind 查注册表分发。
 * 新增策略在 presenters/ 写模块并在 registry 注册即可，本组件无需改动。
 *
 * 运行时输入（说话态/包络/减弱动态）在这里拼进 `PresentationContext`：
 * 它们不是患者属性，不能进 build 的纯函数；缺省值让所有策略保持静态行为。
 */
export default function PatientPresenter({
	presentation,
	size,
	rounded = "2xl",
	fill,
	className,
	speaking = false,
	envelope = 0,
	reducedMotion,
}: {
	presentation: PatientPresentation;
	/** 非 fill（定尺寸）时必传；fill 铺满容器宽时忽略。 */
	size?: number;
	rounded?: "full" | "2xl";
	fill?: boolean;
	className?: string;
	/** 患者在说话（`tts:start`/`tts:end` 或陈列台播放器）。 */
	speaking?: boolean;
	/** 音频包络 0..1（`hooks/useAudioEnvelope`）。 */
	envelope?: number;
	/** 显式覆盖系统「减弱动态」偏好；缺省跟随系统。 */
	reducedMotion?: boolean;
}) {
	const prefersReducedMotion = useReducedMotion();
	const ctx: PresentationContext = {
		size,
		rounded,
		fill,
		className,
		speaking,
		envelope,
		reducedMotion: reducedMotion ?? prefersReducedMotion,
	};
	return PRESENTERS[presentation.kind].render(presentation, ctx);
}
