import type { EmotionState } from "@/engine/PluginContext";
import { EMOTION_LABELS } from "@/engine/PluginContext";
import type { PatientData } from "@/engine/types";
import { getPatientPortraitUrl } from "@/utils/patient-portrait";

interface PatientPortraitProps {
	patient: PatientData;
	emotion?: string | null;
	emotionEnabled?: boolean;
}

export function PatientPortrait({
	patient,
	emotion,
	emotionEnabled,
}: PatientPortraitProps) {
	const effectiveEmotion = emotionEnabled ? emotion : null;
	const avatarSrc = getPatientPortraitUrl(patient, effectiveEmotion);
	const showEmotionLabel =
		emotionEnabled && emotion && emotion !== "neutral";

	return (
		<div className="text-center space-y-2">
			<div className="relative mx-auto w-44 h-56 overflow-hidden rounded-xl border-2 border-border bg-muted">
				<img
					src={avatarSrc}
					alt={patient.name}
					className="w-full h-full object-cover"
				/>
			</div>
			{showEmotionLabel && (
				<p className="text-xs text-muted-foreground">
					{EMOTION_LABELS[emotion as EmotionState]}
				</p>
			)}
		</div>
	);
}
