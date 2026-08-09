import { getPatientAvatar } from "@/utils/avatar";
import { getPatientPortraitUrl } from "@/utils/patient-portrait";
import { appearanceForPatient } from "../face/appearance";
import { faceConfigFrom4D } from "../face/expressionMap";
import { premiumExtrasFrom4D } from "../face/premiumExtras";
import type {
	PatientIdentity,
	PatientPresentation,
	PresentationMode,
	EmotionSnapshot,
} from "./types";

/**
 * 表现构建 — 纯函数：情绪快照 + 患者身份 → 表现描述。
 * 不触碰 React/组件，便于单元测试与未来接入视频导播等新 kind。
 */

/** 当前表现模式 — 未来切换技术栈只改这里（如 "svg" / "png-variant"）。 */
export const PATIENT_PRESENTATION_MODE: PresentationMode = "image";

export function buildPatientPresentation(
	patient: PatientIdentity | null,
	emotion: EmotionSnapshot,
	mode: PresentationMode = PATIENT_PRESENTATION_MODE,
): PatientPresentation {
	switch (mode) {
		case "image":
			return {
				kind: "image",
				src: getPatientAvatar(patient),
				alt: patient?.name ?? "患者",
			};
		case "png-variant":
			return {
				kind: "png-variant",
				src: getPatientPortraitUrl(patient, emotion.emotion),
				alt: patient?.name ?? "患者",
			};
		case "svg":
			return {
				kind: "svg",
				cfg: faceConfigFrom4D(emotion.emotion4D, emotion.values),
				extras: premiumExtrasFrom4D(emotion.emotion4D, emotion.values),
				appearance: appearanceForPatient(patient?.age, patient?.gender),
			};
	}
}
