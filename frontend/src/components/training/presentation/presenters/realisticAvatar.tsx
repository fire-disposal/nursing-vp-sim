import type { PatientPresenter } from "../types";
import { renderAvatarImage, resolvePatientPortrait } from "./shared";

/**
 * realistic — 写实画风专属病例头像路由器。
 * 选图规则在 `resolvePatientPortrait`。
 * 只对写实照片负责：没有照片时返回 null，让位给链上下一个策略（程序化绘制）。
 */
export const realisticAvatarPresenter: PatientPresenter = {
	kind: "realistic",
	build(patient, emotion) {
		const portrait = resolvePatientPortrait(patient, emotion);
		if (!portrait) return null;
		return { kind: "realistic", src: portrait.src, alt: portrait.alt };
	},
	render(payload, ctx) {
		if (payload.kind !== "realistic") return null;
		return renderAvatarImage(payload, ctx);
	},
};
