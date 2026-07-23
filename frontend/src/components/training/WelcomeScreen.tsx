import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { usePortrait } from "@/engine";
import type { PatientData } from "@/engine/types";
import { getPatientAvatar } from "@/utils/avatar";
import { getQuickPrompts } from "./quick-prompts";

interface WelcomeScreenProps {
	patient: PatientData;
	onQuickPrompt?: (text: string) => void;
}

export function WelcomeScreen({ patient, onQuickPrompt }: WelcomeScreenProps) {
	const { portraitUrl } = usePortrait();
	const avatarSrc =
		portraitUrl ||
		getPatientAvatar({ name: patient.name, gender: patient.gender });

	const genderLabel = patient.gender === "male" ? "男" : "女";
	const ageLabel = patient.age ? `${patient.age}岁` : "";
	const subInfo = [genderLabel, ageLabel].filter(Boolean).join(" · ");

	const prompts = useMemo(() => getQuickPrompts(patient), [patient]);

	return (
		<div className="px-3 py-4 mx-auto w-full max-w-3xl">
			<Card className="p-4 space-y-3">
				<div className="flex items-center gap-3">
					<img
						className="size-10 rounded-full object-cover shrink-0 bg-muted ring-2 ring-border"
						src={avatarSrc}
						alt={patient.name}
					/>
					<div className="min-w-0">
						<h2 className="text-sm font-bold text-foreground truncate">
							{patient.name}
						</h2>
						<p className="text-xs text-muted-foreground">{subInfo}</p>
					</div>
				</div>

				<div className="space-y-1.5">
					{patient.chiefComplaint && (
						<div className="flex items-baseline gap-2 text-xs">
							<span className="text-muted-foreground shrink-0">主诉</span>
							<span className="text-foreground">{patient.chiefComplaint}</span>
						</div>
					)}
					<div className="flex items-baseline gap-2 text-xs">
						<span className="text-muted-foreground shrink-0">病案</span>
						<span className="text-foreground">{patient.caseTitle || "未提供"}</span>
					</div>
				</div>

				<div className="pt-3 border-t border-border">
					<div className="flex flex-col gap-2 w-full">
						{prompts.map((prompt, i) => (
							<button
								key={i}
								type="button"
								onClick={() => onQuickPrompt?.(prompt)}
								className="rounded-xl border bg-card px-4 py-2.5 text-sm text-left hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
							>
								{prompt}
							</button>
						))}
					</div>
				</div>
			</Card>
		</div>
	);
}
