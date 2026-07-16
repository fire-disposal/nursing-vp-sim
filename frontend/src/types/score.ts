export interface ScoreItemData {
	id?: number;
	name: string;
	score: number;
	max?: number;
	evidence?: string;
	reason?: string;
}

export interface DetailScoreCategory {
	score: number;
	max: number;
	items?: ScoreItemData[];
}

export interface ScoreReviewData {
	detail_scores?: Record<string, unknown> | null;
	total_score?: number | null;
	comment?: string | null;
	reviewed_at?: string | null;
}

export interface ScoreData {
	total_score: number;
	detail_scores?: Record<string, DetailScoreCategory>;
	strengths?: string[];
	weaknesses?: string[];
	missed_content?: string[];
	suggestions?: string;
	rubric_version?: string;
	review?: ScoreReviewData | null;
}
