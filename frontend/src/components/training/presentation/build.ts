import type {
	EmotionSnapshot,
	PatientIdentity,
	PatientPresentation,
	PresentationKind,
} from "./types";
import { PRESENTERS } from "./registry";
import { staticAvatarPresenter } from "./presenters/staticAvatar";

/**
 * 策略链 — 顺序即优先级；策略 build 返回 null 时交给下一策略。
 * 约束：链必须终止于恒适用策略（static），保证永不落空。
 *
 * 当前生产链：realistic（论文病例写实）→ static（简洁兜底）。
 */
export const PRESENTATION_CHAIN: PresentationKind[] = ["realistic", "static"];

export function buildPatientPresentation(
	patient: PatientIdentity | null,
	emotion: EmotionSnapshot,
	chain: PresentationKind[] = PRESENTATION_CHAIN,
): PatientPresentation {
	for (const kind of chain) {
		const built = PRESENTERS[kind].build(patient, emotion);
		if (built) return built;
	}
	// 防御：链配置错误（如不含 static）时兜底到简洁画风。
	return staticAvatarPresenter.build(patient, emotion) as PatientPresentation;
}
