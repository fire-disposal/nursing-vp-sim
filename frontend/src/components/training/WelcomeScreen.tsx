import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { usePortrait } from "@/engine";
import type { PatientData } from "@/engine/types";
import { getPatientAvatar } from "@/utils/avatar";

interface WelcomeScreenProps {
	patient: PatientData;
	onQuickPrompt?: (text: string) => void;
	capabilities?: Record<string, boolean>;
}

export function WelcomeScreen({ patient, onQuickPrompt: _onQuickPrompt, capabilities = {} }: WelcomeScreenProps) {
	const { portraitUrl } = usePortrait();
	const avatarSrc = portraitUrl || getPatientAvatar({ name: patient.name, gender: patient.gender });

	const genderLabel = patient.gender === "male" ? "男" : "女";
	const ageLabel = patient.age ? `${patient.age}岁` : "";
	const subInfo = [genderLabel, ageLabel].filter(Boolean).join(" · ");

	const flowSteps = useMemo(() => {
		const steps: { icon: string; label: string }[] = [
			{ icon: "🗣️", label: "问诊采集" },
		];
		if (capabilities.physical_exam) steps.push({ icon: "💓", label: "护理查体" });
		if (capabilities.nursing_record) steps.push({ icon: "📄", label: "护理记录" });
		steps.push({ icon: "✅", label: "结束评分" });
		return steps;
	}, [capabilities]);

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
					{flowSteps.map((s, i) => (
						<span key={s.label} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
							{s.icon} {s.label}
							{i < flowSteps.length - 1 && <span className="text-muted-foreground/30 mx-0.5">→</span>}
						</span>
					))}
				</div>


				<p className="text-xs text-muted-foreground/70 pt-2 border-t border-border leading-relaxed">
					在下方输入框中向患者提问，开始采集病史。完成问诊后点击右上角
					<span className="font-medium text-foreground">"结束训练"</span>提交评分。
				</p>
			</Card>
		</div>
	);
}
