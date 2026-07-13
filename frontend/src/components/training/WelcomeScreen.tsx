import { Card } from "@/components/ui/card";
import { usePortrait } from "@/engine";
import type { PatientData } from "@/engine/types";
import { getPatientAvatar } from "@/utils/avatar";

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

	return (
		<div className="px-3 py-4">
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

				<div className="pt-1 border-t border-border flex items-center gap-2">
					<span className="text-[10px] text-muted-foreground">快速开始：</span>
					<button
						type="button"
						onClick={() => onQuickPrompt?.("您好，请问哪里不舒服？")}
						className="text-[11px] text-primary hover:underline"
					>
						您好，请问哪里不舒服？
					</button>
				</div>
			</Card>
		</div>
	);
}
