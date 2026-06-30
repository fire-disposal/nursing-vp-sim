import { useQuery } from "@tanstack/react-query";
import { Heart, User } from "lucide-react";
import { getRecordDetail } from "@/api/training";
import { getTrainingState } from "@/api/training-state";

interface Props {
	recordId: string;
}

export default function PatientInfoPanel({ recordId }: Props) {
	const { data: record } = useQuery({
		queryKey: ["training-record", recordId],
		queryFn: () => getRecordDetail(Number(recordId)).then((r) => r.data),
	});

	const cd = ((record as Record<string, unknown>)?.case_data as Record<string, unknown>) || {};
	const patient = (cd.patient_info as Record<string, unknown>) || {};
	const personality = (cd.personality as Record<string, unknown>) || {};
	const features = (record as Record<string, unknown>)?.features as Record<string, boolean> | undefined;

	const name = String(patient.name || "患者");
	const age = String(patient.age ?? "");
	const gender = String(patient.gender || "");
	const chiefComplaint = String(cd.chief_complaint || "无");
	const healthLiteracy = String(personality.health_literacy || "");
	const verbosity = String(personality.verbosity || "");
	const anxietyTrait = String(personality.anxiety_trait || "");

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3 pb-3 border-b">
				<div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
					<User className="text-primary" size={24} />
				</div>
				<div>
					<p className="font-semibold text-base">{name}</p>
					<p className="text-sm text-muted-foreground">
						{age ? `${age}岁` : ""} · {gender}
					</p>
				</div>
			</div>

			<div>
				<p className="text-xs text-muted-foreground mb-1">主诉</p>
				<p className="text-sm font-medium">{chiefComplaint}</p>
			</div>

			{healthLiteracy && (
				<div>
					<p className="text-xs text-muted-foreground mb-1">患者特征</p>
					<div className="flex flex-wrap gap-1">
						<HealthTag
							label={
								healthLiteracy === "low"
									? "健康素养低"
									: healthLiteracy === "high"
										? "健康素养高"
										: "正常"
							}
						/>
						<HealthTag
							label={
								verbosity === "terse" ? "寡言" : verbosity === "verbose" ? "健谈" : "正常交流"
							}
						/>
						<HealthTag label={anxietyTrait === "anxious" ? "易焦虑" : "心态平稳"} />
					</div>
				</div>
			)}

			{features?.emotion ? (
				<LiveEmotion recordId={recordId} />
			) : null}
		</div>
	);
}

function LiveEmotion({ recordId }: { recordId: string }) {
	const { data: resp } = useQuery({
		queryKey: ["training-state", recordId],
		queryFn: () => getTrainingState(Number(recordId)),
		refetchInterval: 3000,
	});
	const e = (resp as unknown as { data: { emotion?: { state: string; trust: number; comfort: number } } })?.data?.emotion;
	const trust = e?.trust ?? 50;
	const comfort = e?.comfort ?? 50;
	return (
		<div className="p-3 bg-blue-50 rounded-lg">
			<div className="flex items-center gap-2 mb-2">
				<Heart size={14} className="text-blue-600" />
				<span className="text-xs font-medium text-blue-700">患者情绪</span>
				<span className="text-[10px] ml-auto text-blue-500">{e?.state || "neutral"}</span>
			</div>
			<div className="space-y-1.5">
				<Bar label="信赖" value={trust} color="bg-blue-500" />
				<Bar label="舒适" value={comfort} color="bg-teal-500" />
			</div>
		</div>
	);
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
	return (
		<div>
			<div className="flex justify-between text-[10px] text-blue-600 mb-0.5">
				<span>{label}</span>
				<span>{value}</span>
			</div>
			<div className="h-1.5 rounded-full bg-blue-200/50 overflow-hidden">
				<div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${value}%` }} />
			</div>
		</div>
	);
}

function HealthTag({ label }: { label: string }) {
	return (
		<span className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
			{label}
		</span>
	);
}
