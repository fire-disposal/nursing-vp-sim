import { Card } from "@/components/ui/card";
import { usePortrait } from "@/engine/PluginContext";
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
		<div className="flex h-full items-center justify-center p-4">
			<div className="text-center space-y-6 max-w-sm w-full">
				<Card className="p-6 text-center space-y-4">
					<img
						className="w-20 h-20 rounded-full object-cover mx-auto bg-muted ring-4 ring-border"
						src={avatarSrc}
						alt={patient.name}
					/>
					<div>
						<h2 className="text-lg font-bold text-foreground">
							{patient.name}
						</h2>
						<p className="text-sm text-muted-foreground">{subInfo}</p>
					</div>
					<div className="space-y-2 text-left">
						{patient.chiefComplaint && (
							<div className="rounded-lg border bg-muted/30 p-3">
								<div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
									主诉
								</div>
								<p className="text-sm leading-relaxed">
									{patient.chiefComplaint}
								</p>
							</div>
						)}
						{patient.personality && (
							<div className="rounded-lg border bg-muted/30 p-3">
								<div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
									性格特征
								</div>
								<p className="text-sm leading-relaxed">{patient.personality}</p>
							</div>
						)}
						<div className="rounded-lg border bg-muted/30 p-3">
							<div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
								病案
							</div>
							<p className="text-sm leading-relaxed">
								{patient.caseTitle || "未提供"}
							</p>
						</div>
					</div>
				</Card>
				<div className="text-center space-y-2">
					<p className="text-sm text-muted-foreground">
						在下方输入框开始与患者对话
					</p>
					<button
						type="button"
						onClick={() => onQuickPrompt?.("您好，请问哪里不舒服？")}
						className="text-xs text-primary hover:underline"
					>
						试试："您好，请问哪里不舒服？"
					</button>
				</div>
			</div>
		</div>
	);
}
