import type { EmotionState } from "@/engine/PluginContext";
import { EMOTION_LABELS, getEmotionBorder } from "@/engine/PluginContext";
import type { PatientData } from "@/engine/types";
import { cn } from "@/lib/utils";
import { getPatientPortraitUrl } from "@/utils/patient-portrait";

interface PatientPortraitProps {
	patient: PatientData;
	emotion?: string | null;
	emotionEnabled?: boolean;
	trust?: number;
	comfort?: number;
}

export function PatientPortrait({
	patient,
	emotion,
	emotionEnabled,
	trust,
	comfort,
}: PatientPortraitProps) {
	const effectiveEmotion = emotionEnabled ? emotion : null;
	const avatarSrc = getPatientPortraitUrl(patient, effectiveEmotion);
	const showEmotionLabel =
		emotionEnabled && emotion && emotion !== "neutral";

	const borderClass =
		emotionEnabled && emotion
			? getEmotionBorder(emotion as EmotionState)
			: "border-border";

	return (
		<div className="text-center space-y-2">
			<div
				className={cn(
					"relative mx-auto size-56 overflow-hidden rounded-full border-2 bg-muted transition-colors duration-500",
					borderClass,
				)}
			>
				<img
					src={avatarSrc}
					alt={patient.name}
					className="w-full h-full object-cover"
				/>
			</div>
			{showEmotionLabel && (
				<div className="text-xs text-muted-foreground space-y-0.5">
					<p>{EMOTION_LABELS[emotion as EmotionState]}</p>
					{trust !== undefined && comfort !== undefined && (
						<p className="tabular-nums">
							信任 {trust} · 舒适 {comfort}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
