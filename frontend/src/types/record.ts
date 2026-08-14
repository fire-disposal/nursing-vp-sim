import type { ScoreData } from "@/types/score";

/** TrainingRecordBrief 的本地扩展：为弱类型消费点补齐字段（与生成类型对齐） */
export interface RecordExtended {
	id: number;
	case_id: number;
	case_name: string;
	user_id?: number;
	user_display_name?: string;
	user_student_id?: string | null;
	score_reviewed?: boolean;
	start_time: string;
	end_time: string | null;
	status: string;
	score_total?: number | null;
	scoring_status?: string | null;
	scoring_error?: string | null;
	score?: ScoreData | null;
}
