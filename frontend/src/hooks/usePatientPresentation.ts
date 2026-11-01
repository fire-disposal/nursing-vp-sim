import { useMemo } from "react";
import { buildPatientPresentation } from "@/components/training/presentation/build";
import type { PatientIdentity, PatientPresentation } from "@/components/training/presentation/types";
import { useTrainingStore } from "@/stores/trainingStore";

/**
 * 患者表现负载 — 患者身份（病例）+ 当前情绪快照 → 可渲染负载。
 *
 * 患者区与聊天气泡共用这一份，保证同一患者在任何尺寸下都是同一张脸；
 * 情绪（含四维数值）只从 store 读一次，避免两个消费方各自拼快照。
 */
export function usePatientPresentation(patient: PatientIdentity | null): PatientPresentation {
	const emotion = useTrainingStore((s) => s.emotion);
	const emotion4D = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);
	const values = useMemo(
		() => ({ trust, anxiety, irritation, cooperation }),
		[trust, anxiety, irritation, cooperation],
	);
	return useMemo(
		() => buildPatientPresentation(patient, { emotion, emotion4D, values }),
		[patient, emotion, emotion4D, values],
	);
}
