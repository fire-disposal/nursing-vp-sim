import { useMutation } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { useState } from "react";
import { performExam } from "@/api/training";

interface Props {
	recordId: string;
}

const EXAM_OPS = [
	{ id: "temp", label: "体温", unit: "°C" },
	{ id: "bp", label: "血压", unit: "mmHg" },
	{ id: "hr", label: "心率", unit: "次/分" },
	{ id: "rr", label: "呼吸", unit: "次/分" },
	{ id: "spo2", label: "血氧", unit: "%" },
	{ id: "skin", label: "皮肤", unit: "" },
	{ id: "pain", label: "疼痛评分", unit: "/10" },
];

export default function ExamPanel({ recordId }: Props) {
	const [results, setResults] = useState<Record<string, string>>({});

	const examMutation = useMutation({
		mutationFn: (opType: string) => performExam(Number(recordId), opType).then((r) => r.data),
		onSuccess: (data) => {
			if (data.data?.value) {
				setResults((prev) => ({ ...prev, [data.type]: data.data.value + (data.data.unit || "") }));
			}
		},
	});

	return (
		<div className="space-y-3">
			<p className="text-xs text-muted-foreground">点击执行查体操作</p>
			<div className="grid grid-cols-2 gap-2">
				{EXAM_OPS.map((op) => (
					<button
						key={op.id}
						type="button"
						onClick={() => examMutation.mutate(op.id)}
						disabled={examMutation.isPending}
						className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors disabled:opacity-50"
					>
						<div className="flex items-center gap-2">
							<Stethoscope size={14} className="text-muted-foreground" />
							<span className="text-sm">{op.label}</span>
						</div>
						<span className="text-sm font-mono text-muted-foreground">
							{results[op.id] || "—"}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}
