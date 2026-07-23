import { ListChecks } from "lucide-react";
import { useMemo } from "react";
import { useTrainingContext } from "@/engine/TrainingContext";
import { computeCovered } from "./tools/inquiryProgress";

export function InquiryProgressChip() {
	const { bus, messages, recordDetail } = useTrainingContext();

	const inquiries: string[] = useMemo(() => {
		const cd = (recordDetail?.case_data as Record<string, unknown>) ?? {};
		return (cd.required_inquiries as string[]) ?? [];
	}, [recordDetail]);

	const studentText = useMemo(
		() =>
			messages
				.filter((m) => m.role === "student")
				.map((m) => String(m.content || ""))
				.join(""),
		[messages],
	);

	const covered = useMemo(() => computeCovered(inquiries, studentText), [inquiries, studentText]);

	if (inquiries.length === 0) return null;

	const done = covered.size;
	const total = inquiries.length;

	return (
		<button
			type="button"
			onClick={() => bus.emit("tool:open", { id: "inquiry" })}
			className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-card text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
			title={`问诊目标 ${done}/${total}，点击查看指引`}
		>
			<ListChecks size={12} />
			<span className="tabular-nums">{done}/{total}</span>
			{done < total && <span className="size-1.5 rounded-full bg-warning" />}
		</button>
	);
}
