import { getRealisticPatientAvatar } from "@/utils/avatar";
import type { PatientPresenter } from "../types";
import { renderAvatarImage } from "./shared";

/**
 * realistic — 写实画风专属病例头像路由器。
 * 按患者姓名取 realistic/ 目录写实 PNG；未绑定或文件缺失返回 null，让位给链上下一策略。
 */
export const realisticAvatarPresenter: PatientPresenter = {
	kind: "realistic",
	build(patient) {
		const src = getRealisticPatientAvatar(patient?.name);
		if (!src) return null;
		return { kind: "realistic", src, alt: patient?.name ?? "患者" };
	},
	render(payload, ctx) {
		if (payload.kind !== "realistic") return null;
		return renderAvatarImage(payload, ctx);
	},
};
