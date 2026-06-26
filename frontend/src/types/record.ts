import type { ScoreData } from "@/types/score";

export interface RecordExtended {
	id: number;
	case_id: number;
	case_name: string;
	user_display_name?: string;
	start_time: string;
	end_time: string | null;
	status: string;
	score_total?: number | null;
	scoring_status?: string | null;
	scoring_error?: string | null;
	score?: ScoreData | null;
}
