import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useTrainingStore } from "@/stores/trainingStore";
import type { PatientData } from "@/engine/types";
import { getPatientAvatar, safeAvatarUrl } from "@/utils/avatar";
import { getQuickPrompts } from "./quick-prompts";

interface WelcomeScreenProps {
	patient: PatientData;
	onQuickPrompt?: (text: string) => void;
	capabilities?: Record<string, boolean>;
}

export function WelcomeScreen({ patient, onQuickPrompt, capabilities = {} }: WelcomeScreenProps) {
	const portraitUrl = useTrainingStore((s) => s.portraitUrl);
	const fallbackAvatar = getPatientAvatar({ name: patient.name, gender: patient.gender });
	const avatarSrc = safeAvatarUrl(portraitUrl, fallbackAvatar);

	const genderLabel = patient.gender === "male" ? "男" : "女";
	const ageLabel = patient.age ? `${patient.age}岁` : "";
	const subInfo = [genderLabel, ageLabel].filter(Boolean).join(" · ");

	const flowSteps = useMemo(() => {
		const steps = ["问诊采集"];
		if (capabilities.physical_exam) steps.push("护理查体");
		if (capabilities.nursing_record) steps.push("护理记录");
		steps.push("结束评分");
		return steps;
	}, [capabilities]);

	const quickPrompts = useMemo(
		() => getQuickPrompts(patient),
		[patient],
	);

	return (
		<div className="px-3 py-4 mx-auto w-full max-w-3xl">
			<Card className="p-5 space-y-4 bg-gradient-to-br from-primary/5 to-accent/10">
				<div className="flex items-center gap-4">
					<img className="size-14 rounded-full object-cover shrink-0 bg-muted ring-2 ring-border"
						src={avatarSrc} alt={patient.name} />
					<div className="min-w-0">
						<h2 className="text-base font-bold text-foreground truncate">{patient.name}</h2>
						<p className="text-sm text-muted-foreground">{subInfo}</p>
						{patient.chiefComplaint && (
							<p className="text-xs text-muted-foreground mt-0.5 truncate">主诉：{patient.chiefComplaint}</p>
						)}
					</div>
				</div>

				<div className="flex items-center gap-2 flex-wrap">
					{flowSteps.map((label, i) => (
						<span key={label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
							<span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary tabular-nums">
								{i + 1}
							</span>
							{label}
						</span>
					))}
				</div>

				{onQuickPrompt && (
					<div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
						<p className="text-xs font-medium text-muted-foreground">建议开场</p>
						<div className="flex flex-wrap gap-2">
							{quickPrompts.map((prompt) => (
								<button
									key={prompt}
									type="button"
									onClick={() => onQuickPrompt(prompt)}
									className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 active:scale-[0.98]"
								>
									{prompt}
								</button>
							))}
						</div>
					</div>
				)}


				<p className="text-xs text-muted-foreground/70 pt-2 border-t border-border leading-relaxed">
					在下方输入框中向患者提问，开始采集病史。完成问诊后点击右上角
					<span className="font-medium text-foreground">"结束训练"</span>提交评分。
				</p>
			</Card>
		</div>
	);
}
