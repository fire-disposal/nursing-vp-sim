import { getRealisticPatientAvatar } from "@/utils/avatar";
import type { PatientPresenter } from "../types";
import { renderAvatarImage } from "./shared";

/**
 * realistic — 写实画风专属病例头像路由器。
 * 取图优先级（都在病例里声明，缺省不改变既有行为）：
 *   1. 当前情绪有专属立绘（``patient_info.portrait_states``）→ 用这一张（在场感）；
 *   2. 否则按患者姓名取论文专属写实 PNG（未声明 portrait_states 时与过去完全一致）。
 * 两者都没有（未绑定 / 文件缺失）返回 null，让位给链上下一策略（简洁画风）。
 */
export const realisticAvatarPresenter: PatientPresenter = {
	kind: "realistic",
	build(patient, emotion) {
		const src = patient?.portraitStates?.[emotion.emotion] ?? getRealisticPatientAvatar(patient?.name);
		if (!src) return null;
		return { kind: "realistic", src, alt: patient?.name ?? "患者" };
	},
	render(payload, ctx) {
		if (payload.kind !== "realistic") return null;
		return renderAvatarImage(payload, ctx);
	},
};
