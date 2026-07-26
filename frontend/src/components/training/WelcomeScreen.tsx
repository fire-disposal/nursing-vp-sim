import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { usePortrait } from "@/engine";
import type { PatientData } from "@/engine/types";
import { getPatientAvatar } from "@/utils/avatar";
import { getQuickPrompts } from "./quick-prompts";

interface WelcomeScreenProps {
	patient: PatientData;
	onQuickPrompt?: (text: string) => void;
	capabilities?: Record<string, boolean>;
}

interface FlowStep {
	icon: string;
	label: string;
	desc: string;
}

export function WelcomeScreen({ patient, onQuickPrompt, capabilities = {} }: WelcomeScreenProps) {
	const { portraitUrl } = usePortrait();
	const avatarSrc =
		portraitUrl ||
		getPatientAvatar({ name: patient.name, gender: patient.gender });

	const genderLabel = patient.gender === "male" ? "男" : "女";
	const ageLabel = patient.age ? `${patient.age}岁` : "";
	const subInfo = [genderLabel, ageLabel].filter(Boolean).join(" · ");

	const prompts = useMemo(() => getQuickPrompts(patient), [patient]);

	const flowSteps = useMemo<FlowStep[]>(
		() => [
			{ icon: "🗣️", label: "问诊采集", desc: "询问主诉、现病史、既往史" },
			capabilities.physical_exam ? { icon: "💓", label: "护理查体", desc: "测量生命体征" } : null,
			capabilities.nursing_record ? { icon: "📄", label: "护理记录", desc: "填写护理评估记录" } : null,
			{ icon: "✅", label: "结束训练", desc: "系统自动评分并反馈" },
		].filter((s): s is FlowStep => s !== null),
		[capabilities],
	);

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

				{flowSteps.length > 1 && (
					<div className="pt-3 border-t border-border">
						<div className="text-xs font-medium text-muted-foreground mb-2">训练流程</div>
						<ol className="space-y-1.5">
							{flowSteps.map((s, i) => (
								<li key={s.label} className="flex items-center gap-2.5 text-xs">
									<span className="flex items-center justify-center size-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">
										{i + 1}
									</span>
									<span className="shrink-0">{s.icon} {s.label}</span>
									<span className="text-muted-foreground truncate">{s.desc}</span>
								</li>
							))}
						</ol>
						<p className="mt-2 text-[11px] text-muted-foreground/70">
							对话过程中可随时通过工具栏打开问诊指引、查体与记录工具。
						</p>
					</div>
				)}

				<div className="pt-3 border-t border-border">
					<p className="text-[11px] text-muted-foreground/70 mb-2.5">选择一句开始与患者对话：</p>
					<div className="flex flex-col gap-2 w-full">
						{prompts.map((prompt, i) => (
							<button
								key={i}
								type="button"
								onClick={() => onQuickPrompt?.(prompt)}
								className="rounded-xl border bg-card px-4 py-3 text-sm text-left hover:border-primary/50 hover:bg-primary/5 active:scale-[0.98] transition-all cursor-pointer min-h-[44px]"
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
