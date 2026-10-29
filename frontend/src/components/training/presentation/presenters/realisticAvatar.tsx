import type { PatientPresenter } from "../types";
import { renderAvatarImage, resolvePatientPortrait } from "./shared";

/**
 * realistic — 写实画风专属病例头像路由器。
 * 选图规则在 `resolvePatientPortrait`（realistic / live 共用一份）。
 * 只对写实照片负责：落到简洁画风时返回 null，让位给链上下一策略。
 */
export const realisticAvatarPresenter: PatientPresenter = {
	kind: "realistic",
	build(patient, emotion) {
		const portrait = resolvePatientPortrait(patient, emotion);
		if (portrait.art !== "photo") return null;
		return { kind: "realistic", src: portrait.src, alt: portrait.alt };
	},
	render(payload, ctx) {
		if (payload.kind !== "realistic") return null;
		return renderAvatarImage(payload, ctx);
	},
};
