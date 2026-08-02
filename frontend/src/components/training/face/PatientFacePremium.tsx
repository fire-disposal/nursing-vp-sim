import { useMemo } from "react";
import { useTrainingStore } from "@/stores/trainingStore";
import { appearanceForPatient } from "./appearance";
import { faceConfigFrom4D } from "./expressionMap";
import PremiumFaceArtwork from "./PremiumFaceArtwork";
import { premiumExtrasFrom4D } from "./premiumExtras";

/**
 * PatientFacePremium — 高级患者表情（分层 SVG 插画档）。
 *
 * 与 PatientFace 同接口、同数据源（trainingStore）：情绪 + 患者年龄/性别
 * （外观经 appearanceForPatient 解析，兼容匿名盲盒）。
 * 回退链中位于 PatientFace 之前；两者共用 FaceConfig 契约。
 */

interface PatientFacePremiumProps {
	size?: number;
	className?: string;
}

export default function PatientFacePremium({ size = 64, className }: PatientFacePremiumProps) {
	const label = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);
	const patient = useTrainingStore((s) => s.patient);

	const values = useMemo(
		() => ({ trust, anxiety, irritation, cooperation }),
		[trust, anxiety, irritation, cooperation],
	);
	const appearance = useMemo(
		() => appearanceForPatient(patient?.age, patient?.gender),
		[patient?.age, patient?.gender],
	);

	return (
		<PremiumFaceArtwork
			cfg={faceConfigFrom4D(label, values)}
			extras={premiumExtrasFrom4D(label, values)}
			appearance={appearance}
			size={size}
			className={className}
		/>
	);
}
