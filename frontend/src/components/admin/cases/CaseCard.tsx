import { Eye, EyeOff, Pencil, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Button from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DifficultyBadge } from "@/components/ui/difficulty-badge";
import { cn } from "@/utils/cn";
import type { CaseManageItem } from "./types";

interface CaseCardProps {
	caseData: CaseManageItem;
	onEdit: (id: number) => void;
	onDelete: (id: number) => void;
	onToggleOpen: (id: number, open: boolean) => void;
	onStartTraining: (id: number) => void;
}

const CAPABILITY_LABELS: Record<string, string> = {
	patient_initiative: "患者自主",
	nursing_record: "护理记录",
	physical_exam: "护理查体",
	emotion_detection: "情绪识别",
};

export default function CaseCard({
	caseData,
	onEdit,
	onDelete,
	onToggleOpen,
	onStartTraining,
}: CaseCardProps) {
	const isTriage = caseData.training_type === "triage";

	const enabledCapabilities = Object.entries(caseData.capabilities ?? {})
		.filter(([, v]) => v)
		.map(([k]) => CAPABILITY_LABELS[k])
		.filter(Boolean);

	const patientInfo = [
		caseData.patient_gender,
		caseData.patient_age != null ? `${caseData.patient_age}岁` : null,
		caseData.chief_complaint,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Card className="overflow-hidden">
			<div
				className={cn(
					"h-2 shrink-0",
					isTriage
						? "bg-gradient-to-r from-amber-400 to-amber-600"
						: "bg-gradient-to-r from-teal-400 to-teal-600",
				)}
			/>
			<CardHeader>
				<div className="flex items-center justify-between gap-2">
					<CardTitle className="truncate">{caseData.name}</CardTitle>
					<DifficultyBadge level={caseData.difficulty} />
				</div>
				{patientInfo && (
					<p className="text-sm text-muted-foreground truncate">
						{patientInfo}
					</p>
				)}
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				{enabledCapabilities.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{enabledCapabilities.map((label) => (
							<Badge key={label} variant="outline">
								{label}
							</Badge>
						))}
					</div>
				)}
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">
						训练次数:{" "}
						<span
							className={cn(
								"font-medium",
								caseData.training_count > 0
									? "text-primary"
									: "text-muted-foreground/70",
							)}
						>
							{caseData.training_count}
						</span>
					</span>
					<button
						type="button"
						onClick={() =>
							onToggleOpen(caseData.id, !caseData.is_open)
						}
						className={cn(
							"inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
							caseData.is_open
								? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
								: "bg-muted text-muted-foreground hover:bg-muted/70",
						)}
					>
						{caseData.is_open ? (
							<Eye size={13} />
						) : (
							<EyeOff size={13} />
						)}
						{caseData.is_open ? "开放" : "未开放"}
					</button>
				</div>
			</CardContent>
			<CardFooter className="justify-end gap-1">
				<Button
					size="sm"
					onClick={() => onStartTraining(caseData.id)}
					title="开始训练"
				>
					<Play size={14} />
					开始训练
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => onEdit(caseData.id)}
					title="编辑"
				>
					<Pencil size={14} />
				</Button>
				<Button
					size="sm"
					variant="destructive"
					onClick={() => onDelete(caseData.id)}
					disabled={caseData.training_count > 0}
					title={
						caseData.training_count > 0
							? "有训练记录，无法删除"
							: "删除"
					}
				>
					<Trash2 size={14} />
				</Button>
			</CardFooter>
		</Card>
	);
}
