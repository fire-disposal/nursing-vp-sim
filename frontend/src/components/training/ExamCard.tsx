import { Activity, Droplets, Heart, Thermometer, Waves } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface VitalSignResult {
	type: string;
	data: Record<string, unknown>;
}

interface ExamCardProps {
	result: VitalSignResult;
	className?: string;
}

const ICON_MAP: Record<string, ReactNode> = {
	vitals: <Heart className="size-4 text-rose-500" />,
	bp: <Activity className="size-4 text-blue-500" />,
	temp: <Thermometer className="size-4 text-orange-500" />,
	spo2: <Waves className="size-4 text-cyan-500" />,
	hr: <Heart className="size-4 text-rose-500" />,
	rr: <Activity className="size-4 text-teal-500" />,
	skin: <Droplets className="size-4 text-amber-500" />,
	pain: <Activity className="size-4 text-purple-500" />,
};

const TYPE_LABELS: Record<string, string> = {
	vitals: "生命体征",
	bp: "血压",
	temp: "体温",
	spo2: "血氧",
	hr: "心率",
	rr: "呼吸",
	skin: "皮肤",
	pain: "疼痛",
};

export function ExamCard({ result, className }: ExamCardProps) {
	const label = String(result.data?.label || result.type);
	const value = String(result.data?.value ?? "");
	const unit = String(result.data?.unit ?? "");
	const icon = ICON_MAP[result.type] || <Activity className="size-4 text-muted-foreground" />;

	return (
		<div className="flex justify-end px-4">
			<div
				className={cn(
					"inline-flex items-center gap-3 rounded-xl border border-border bg-card/80 px-4 py-2.5 shadow-sm animate-in fade-in-50 slide-in-from-right-2 duration-200",
					className,
				)}
			>
				<div className="flex size-9 items-center justify-center rounded-lg bg-muted">
					{icon}
				</div>
				<div className="flex flex-col">
					<span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						{TYPE_LABELS[result.type] || label}
					</span>
					<span className="text-lg font-bold tabular-nums leading-tight">
						{value}
						{unit && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>}
					</span>
				</div>
			</div>
		</div>
	);
}
