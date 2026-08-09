import { getPatientPortraitUrl } from "@/utils/patient-portrait";
import type { PatientPresenter } from "../types";
import { renderAvatarImage } from "./shared";

/**
 * png-variant — 情绪 PNG 变体路由器。
 * 按情绪取 simple/ 目录的 -{a,h,s,n} 变体 PNG（patient-portrait 复用），保留恢复能力。
 */
export const pngVariantPresenter: PatientPresenter = {
	kind: "png-variant",
	build(patient, emotion) {
		return {
			kind: "png-variant",
			src: getPatientPortraitUrl(patient, emotion.emotion),
			alt: patient?.name ?? "患者",
		};
	},
	render(payload, ctx) {
		if (payload.kind !== "png-variant") return null;
		return renderAvatarImage(payload, ctx);
	},
};
