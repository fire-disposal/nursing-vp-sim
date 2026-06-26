import { BarChart3, Clock, FileText, User } from "lucide-react";
import type { ScoreData } from "@/types/score";

interface RecordStatsBarRecord {
	user_display_name?: string;
	case_name?: string;
}

interface Props {
	record: RecordStatsBarRecord;
	duration: number | null;
	hasScore: boolean;
	recordScore: ScoreData | null;
	scoreMax: number;
}

export default function RecordStatsBar({
	record,
	duration,
	hasScore,
	recordScore,
	scoreMax,
}: Props) {
	return (
		<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
			<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info text-info-foreground">
					<User size={18} />
				</div>
				<div className="min-w-0">
					<div className="text-base font-bold truncate">
						{record.user_display_name || "-"}
					</div>
					<div className="text-xs text-muted-foreground">学生</div>
				</div>
			</div>

			<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
					<FileText size={18} />
				</div>
				<div className="min-w-0">
					<div className="text-base font-bold truncate">
						{record.case_name || "-"}
					</div>
					<div className="text-xs text-muted-foreground">病例</div>
				</div>
			</div>

			<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning text-warning-foreground">
					<Clock size={18} />
				</div>
				<div className="min-w-0">
					<div className="text-xl font-bold">
						{duration != null ? `${duration}分钟` : "-"}
					</div>
					<div className="text-xs text-muted-foreground">训练时长</div>
				</div>
			</div>

			<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success text-success-foreground">
					<BarChart3 size={18} />
				</div>
				<div className="min-w-0">
					<div className="text-xl font-bold">
						{recordScore?.total_score ?? "-"}
					</div>
					<div className="text-xs text-muted-foreground">
						{hasScore ? `得分 / ${scoreMax}` : "得分"}
					</div>
				</div>
			</div>
		</div>
	);
}
