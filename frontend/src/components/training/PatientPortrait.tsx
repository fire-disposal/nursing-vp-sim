import { useCallback, useEffect, useRef, useState } from "react";
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

const CROSSFADE_MS = 400;

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
	const [phase, setPhase] = useState<"idle" | "entering" | "done">("idle");
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const transition = useCallback(() => {
		if (timerRef.current) clearTimeout(timerRef.current);
		setPhase("entering");
		timerRef.current = setTimeout(() => {
			setPrevSrc(avatarSrc);
			setPhase("done");
		}, CROSSFADE_MS);
	}, [avatarSrc]);

	useEffect(() => {
		if (avatarSrc !== prevSrc) transition();
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [avatarSrc, prevSrc, transition]);

	useEffect(() => {
		if (phase === "done") {
			setPhase("idle");
		}
	}, [phase]);

	return (
		<div className="text-center space-y-2">
			<div
				className={cn(
					"relative mx-auto size-56 overflow-hidden rounded-full border-2 bg-muted",
					"transition-colors duration-500",
					borderClass,
				)}
			>
				<img
					src={avatarSrc}
					alt={patient.name}
					className={cn(
						"w-full h-full object-cover",
						"transition-[opacity,filter] duration-[400ms] ease-in-out",
						"will-change-[opacity,filter]",
						phase === "entering" && "opacity-0 blur-sm",
					)}
				/>
				{phase === "entering" && (
					<img
						src={prevSrc}
						alt={patient.name}
						className={cn(
							"absolute inset-0 w-full h-full object-cover",
							"transition-[opacity,filter] duration-[400ms] ease-in-out",
							"will-change-[opacity,filter]",
						)}
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
