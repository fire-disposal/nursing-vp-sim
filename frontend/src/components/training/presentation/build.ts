import type {
	EmotionSnapshot,
	PatientIdentity,
	PatientPresentation,
	PresentationKind,
} from "./types";
import { PRESENTERS } from "./registry";

/**
 * 策略链 — 顺序即优先级；策略 build 返回 null 时交给下一策略。
 * 约束：链必须终止于恒适用策略（mii），保证永不落空。
 *
 * 当前生产链：realistic（论文病例写实）→ mii（无照片病例，程序化绘制）。
 */
export const PRESENTATION_CHAIN: PresentationKind[] = ["realistic", "mii"];

export function buildPatientPresentation(
	patient: PatientIdentity | null,
	emotion: EmotionSnapshot,
): PatientPresentation {
	for (const kind of PRESENTATION_CHAIN) {
		const built = PRESENTERS[kind].build(patient, emotion);
		if (built) return built;
	}
	// mii 是链终点且恒适用；走到这里只可能是注册表/链被改坏。
	return PRESENTERS.mii.build(patient, emotion) as PatientPresentation;
}
