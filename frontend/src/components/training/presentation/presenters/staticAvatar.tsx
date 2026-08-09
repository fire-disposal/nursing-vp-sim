import { getBasePatientAvatar } from "@/utils/avatar";
import type { PatientPresenter, PatientPresentation } from "../types";
import { renderAvatarImage } from "./shared";

/**
 * static — 简洁画风 PNG 路由器。
 * 按年龄/性别取默认头像（simple/ 目录），恒适用，作为策略链兜底。
 */
export const staticAvatarPresenter: PatientPresenter = {
	kind: "static",
	build(patient): PatientPresentation {
		return {
			kind: "static",
			src: getBasePatientAvatar(patient),
			alt: patient?.name ?? "患者",
		};
	},
	render(payload, ctx) {
		if (payload.kind !== "static") return null;
		return renderAvatarImage(payload, ctx);
	},
};
