import { CheckCircle2, Circle } from "lucide-react";
import { useMemo } from "react";
import { useTrainingStore } from "@/stores/trainingStore";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import type { ChatMessage } from "@/engine/types";
import { cn } from "@/lib/utils";
import { computeCovered, getInquiryLabel, progressColor } from "./inquiryProgress";

export default function InquiryTool(props: TrainingToolProps) {
	const messages = useTrainingStore((s) => s.messages);

	const inquiries: string[] = useMemo(() => {
		return (props.recordDetail as { required_inquiries?: string[] })?.required_inquiries ?? [];
	}, [props.recordDetail]);

	const studentText = useMemo(
		() =>
			(messages as ChatMessage[])
				.filter((m) => m.role === "student")
				.map((m) => String(m.content || ""))
				.join(""),
		[messages],
	);

	const covered = useMemo(() => computeCovered(inquiries, studentText), [inquiries, studentText]);

	if (inquiries.length === 0) {
		return <div className="text-sm text-muted-foreground text-center py-8 p-3">该病例未配置问诊清单</div>;
	}

	const doneCount = covered.size;
	const total = inquiries.length;
	const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
	const color = progressColor(pct);

	return (
		<div className="p-3">
			<div className="mb-3">
				<div className="flex items-center justify-between mb-1">
					<span className="text-xs text-muted-foreground">关键问诊内容覆盖</span>
					<span
						className={cn(
							"text-xs font-bold tabular-nums",
							color === "success" && "text-success-foreground",
							color === "warning" && "text-warning",
							color === "danger" && "text-danger",
						)}
					>
						{doneCount}/{total}
					</span>
				</div>
				<div className="h-1.5 rounded-full bg-muted overflow-hidden">
					<div
						className={cn(
							"h-full rounded-full transition-all duration-500",
							color === "success" && "bg-success",
							color === "warning" && "bg-warning",
							color === "danger" && "bg-danger",
						)}
						style={{ width: `${pct}%` }}
					/>
				</div>
			</div>

			<div className="space-y-1">
				{inquiries.map((inq, i) => {
					const done = covered.has(i);
					return (
						<div key={i} className="flex items-start gap-2 py-1.5">
							{done ? (
								<CheckCircle2 size={14} className="text-success-foreground mt-0.5 shrink-0" />
							) : (
								<Circle size={14} className="text-muted-foreground/30 mt-0.5 shrink-0" />
							)}
							<span
								className={cn(
									"text-sm leading-snug",
									done ? "line-through text-muted-foreground" : "text-foreground",
								)}
								title={inq}
							>
								{getInquiryLabel(inq)}
							</span>
						</div>
					);
				})}
			</div>

			<p className="mt-3 pt-2 border-t border-border text-[11px] text-muted-foreground/70 leading-relaxed">
				提示：系统根据对话关键词自动匹配，仅供参考。建议按护理评估框架全面采集病史。
			</p>
		</div>
	);
}
