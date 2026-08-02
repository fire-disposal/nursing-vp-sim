import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrainingStore, EMOTION_4D_LABELS } from "@/stores/trainingStore";
import { appearanceForPatient } from "./appearance";
import { faceConfigFrom4D, type EmotionValues } from "./expressionMap";
import { premiumExtrasFrom4D } from "./premiumExtras";
import PremiumFaceArtwork from "./PremiumFaceArtwork";

/**
 * PatientFacePanel — 训练级患者表情面板（可展开/折叠）。
 *
 * 定位：全局患者呈现组件，不在 tools 协议内（脸是"被观察的对象"，
 * 不需要 case 字段激活，通过年龄/性别适配一切病例）。
 * 数据：trainingStore — 情绪（emotion4D + 4D 数值）与患者（age/gender），
 * 与情绪系统同源，自动激活。
 *
 * 折叠态：小脸行（始终可见，带当前情绪标签）
 * 展开态：大脸 + 情绪标签 + 4D 数值条
 */

const DIM_LABELS: Array<{ key: keyof EmotionValues; name: string; cls: string }> = [
	{ key: "trust", name: "信任", cls: "bg-success-foreground" },
	{ key: "anxiety", name: "焦虑", cls: "bg-purple-500" },
	{ key: "irritation", name: "烦躁", cls: "bg-orange-500" },
	{ key: "cooperation", name: "配合", cls: "bg-blue-500" },
];

interface PatientFacePanelProps {
	className?: string;
}

export default function PatientFacePanel({ className }: PatientFacePanelProps) {
	const [expanded, setExpanded] = useState(false);
	const label = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);
	const patient = useTrainingStore((s) => s.patient);

	const values = useMemo(
		() => ({ trust, anxiety, irritation, cooperation }),
		[trust, anxiety, irritation, cooperation],
	);
	const appearance = useMemo(
		() => appearanceForPatient(patient?.age, patient?.gender),
		[patient?.age, patient?.gender],
	);
	const cfg = useMemo(() => faceConfigFrom4D(label, values), [label, values]);
	const extras = useMemo(() => premiumExtrasFrom4D(label, values), [label, values]);

	if (!expanded) {
		return (
			<button
				type="button"
				onClick={() => setExpanded(true)}
				className={cn(
					"flex w-full items-center gap-2 px-3 sm:px-4 py-1.5 border-b border-border",
					"text-left transition-colors hover:bg-muted/50",
					className,
				)}
			>
				<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={36} />
				<span className="flex-1 truncate text-xs text-muted-foreground">
					患者表情 · {EMOTION_4D_LABELS[label]}
				</span>
				<ChevronDown className="size-4 text-muted-foreground" />
			</button>
		);
	}

	return (
		<div className={cn("flex items-center gap-4 px-3 sm:px-4 py-2 border-b border-border", className)}>
			<PremiumFaceArtwork cfg={cfg} extras={extras} appearance={appearance} size={120} />
			<div className="flex-1 space-y-1.5 min-w-0">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold">{EMOTION_4D_LABELS[label]}</span>
					<span className="font-mono text-[10px] text-muted-foreground">{label as string}</span>
				</div>
				{DIM_LABELS.map((d) => (
					<div key={d.key} className="flex items-center gap-2 text-[10px]">
						<span className="w-6 shrink-0 text-muted-foreground">{d.name}</span>
						<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
							<div
								className={cn("h-full rounded-full transition-all duration-700", d.cls)}
								style={{ width: `${Math.round(values[d.key] * 100)}%` }}
							/>
						</div>
					</div>
				))}
			</div>
			<button
				type="button"
				onClick={() => setExpanded(false)}
				className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
				aria-label="折叠患者表情"
			>
				<ChevronUp className="size-4" />
			</button>
		</div>
	);
}
