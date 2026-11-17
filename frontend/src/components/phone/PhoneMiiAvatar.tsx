import PatientPresenter from "@/components/training/presentation/PatientPresenter";
import { buildPatientPresentation } from "@/components/training/presentation/build";
import type { EmotionState } from "@/stores/trainingStore";
import type { PhoneCharacter } from "@/engine/phone/characters";
import type { PhoneEmotionLabel } from "@/engine/phone/types";

const EMOTION_MAP: Record<PhoneEmotionLabel, EmotionState> = {
	open_trusting: "open",
	trusting_anxious: "anxious",
	irritated: "defensive",
	anxious_cooperative: "anxious",
	anxious_guarded: "anxious",
	withdrawn: "withdrawn",
	defensive: "defensive",
	relaxed: "relaxed",
	neutral: "neutral",
};

export interface PhoneMiiAvatarProps {
	character: PhoneCharacter;
	label: PhoneEmotionLabel;
	speaking: boolean;
	listening?: boolean;
	level?: number;
	reducedMotion?: boolean;
	size?: number;
	fill?: boolean;
	className?: string;
}

/** 电话人物与训练页共用 M3 表情渲染器，只映射通话角色与情绪。 */
export default function PhoneMiiAvatar({
	character,
	label,
	speaking,
	level = 0,
	reducedMotion = false,
	size = 260,
	fill = false,
	className,
}: PhoneMiiAvatarProps) {
	const presentation = buildPatientPresentation(
		{ name: character.name, age: character.age, gender: character.gender },
		{ emotion: EMOTION_MAP[label] ?? "neutral", emotion4D: label, values: character.initial },
	);
	return (
		<PatientPresenter
			presentation={presentation}
			size={size}
			fill={fill}
			className={className}
			speaking={speaking}
			envelope={level}
			reducedMotion={reducedMotion}
		/>
	);
}
