import { CheckCircle2, Circle } from "lucide-react";
import { useMemo } from "react";
import type { PanelTabProps } from "@/engine/types";
import { cn } from "@/lib/utils";

export function InquiryTab({ ctx }: PanelTabProps) {
	const inquiries = ctx.patient.requiredInquiries ?? [];
	const studentMessages = useMemo(
		() => ctx.messages.filter((m) => m.role === "student"),
		[ctx.messages],
	);

	const states = useMemo(
		() =>
			inquiries.map((inquiry) => {
				const short = inquiry.slice(0, 4).toLowerCase();
				const done = studentMessages.some((m) =>
					(m.content ?? "").toLowerCase().includes(short),
				);
				return { inquiry, done };
			}),
		[inquiries, studentMessages],
	);

	const doneCount = states.filter((s) => s.done).length;

	if (inquiries.length === 0) {
		return <p className="text-xs text-muted-foreground">暂无问诊要求</p>;
	}

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between mb-2">
				<span className="text-xs font-semibold text-muted-foreground">
					完成进度
				</span>
				<span className="text-xs tabular-nums font-medium">
					{doneCount}/{inquiries.length}
				</span>
			</div>
			<div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
				<div
					className="h-full rounded-full bg-primary transition-all duration-500"
					style={{ width: `${(doneCount / inquiries.length) * 100}%` }}
				/>
			</div>
			<div className="space-y-0.5">
				{states.map(({ inquiry, done }) => (
					<div
						key={inquiry}
						className={cn(
							"flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
							done
								? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
								: "text-muted-foreground",
						)}
					>
						{done ? (
							<CheckCircle2 size={14} className="text-green-500 shrink-0" />
						) : (
							<Circle size={14} className="shrink-0" />
						)}
						{inquiry}
					</div>
				))}
			</div>
		</div>
	);
}
