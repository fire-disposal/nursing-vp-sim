import { useEffect, useRef, useState } from "react";
import type { EmotionState } from "@/engine";
import { EMOTION_LABELS, getEmotionBorder } from "@/engine";
import type { PatientData } from "@/engine/types";
import { cn } from "@/utils/cn";
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

	const [prevSrc, setPrevSrc] = useState(avatarSrc);
	const [fading, setFading] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (avatarSrc !== prevSrc) {
			setFading(true);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => {
				setPrevSrc(avatarSrc);
				setFading(false);
			}, 350);
			return () => {
				if (timerRef.current) clearTimeout(timerRef.current);
			};
		}
	}, [avatarSrc, prevSrc]);


	return (
		<div className="text-center space-y-2">
			<div
				className={cn(
					"relative mx-auto size-56 overflow-hidden rounded-full border-2 bg-muted transition-colors duration-500",
					borderClass,
				)}
			>
				<img
					src={fading ? prevSrc : avatarSrc}
					alt={patient.name}
					className={cn(
						"w-full h-full object-cover transition-opacity duration-300",
						fading ? "opacity-0" : "opacity-100",
					)}
				/>
				{fading && (
					<img
						src={avatarSrc}
						alt={patient.name}
						className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 opacity-100"
					/>
				)}
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
