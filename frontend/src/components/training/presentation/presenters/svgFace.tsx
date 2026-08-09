import { appearanceForPatient } from "../../face/appearance";
import { faceConfigFrom4D } from "../../face/expressionMap";
import { premiumExtrasFrom4D } from "../../face/premiumExtras";
import PremiumFaceArtwork from "../../face/PremiumFaceArtwork";
import type { PatientPresenter } from "../types";

/**
 * svg — 参数化 SVG 动态渲染器。
 * 4D 情绪数据 → 确定性 FaceConfig/Extras/Appearance → PremiumFaceArtwork（分层 SVG）。
 * 当前不在默认策略链中，保留恢复能力；切链到 ["svg"] 即可复活。
 */
export const svgFacePresenter: PatientPresenter = {
	kind: "svg",
	build(patient, emotion) {
		return {
			kind: "svg",
			cfg: faceConfigFrom4D(emotion.emotion4D, emotion.values),
			extras: premiumExtrasFrom4D(emotion.emotion4D, emotion.values),
			appearance: appearanceForPatient(patient?.age, patient?.gender),
		};
	},
	render(payload, ctx) {
		if (payload.kind !== "svg") return null;
		return (
			<PremiumFaceArtwork
				cfg={payload.cfg}
				extras={payload.extras}
				appearance={payload.appearance}
				size={ctx.size}
			/>
		);
	},
};
