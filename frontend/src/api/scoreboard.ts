import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export interface ScoreboardRankingParams {
	case_id?: number | null;
	class_id?: number | null;
	assignment_id?: string | null;
	assignment_status?: string | null;
	include_free?: boolean;
	search?: string | null;
	sort_by?: string;
	order?: string;
	tier?: string | null;
	offset?: number;
	limit?: number;
}

export type TrendScopeParams = Omit<
	ScoreboardRankingParams,
	"search" | "sort_by" | "order" | "tier" | "offset" | "limit"
>;

export const getScoreboardRanking = (params: ScoreboardRankingParams = {}) =>
	api.get<Schemas["ScoreboardRankingResponse"]>(
		"/scoreboard/ranking" satisfies ApiPath as string,
		{ params },
	);

export const getStudentTrend = (userId: number, params: TrendScopeParams = {}) =>
	api.get<Schemas["StudentTrendResponse"]>(
		`/scoreboard/students/${userId}/trend` as ApiPath,
		{ params },
	);

// ── 学生学习档案：响应形状由 OpenAPI 统一生成 ──
export type StudentProfileTrainingItem = Schemas["StudentProfileTrainingItem"];
export type StudentProfileAssignmentItem = Schemas["StudentProfileAssignmentItem"];
export type StudentProfileClass = Schemas["StudentProfileClass"];
export type StudentProfileIdentity = Schemas["StudentProfileIdentity"];
export type StudentProfileTrainingSummary = Schemas["StudentProfileTrainingSummary"];
export type StudentLearningProfile = Schemas["StudentLearningProfileResponse"];

export interface StudentLearningProfileParams extends TrendScopeParams {
	/** in_progress | completed | abandoned | discarded */
	training_status?: string | null;
	training_offset?: number;
	training_limit?: number;
}

export const getStudentLearningProfile = (userId: number, params: StudentLearningProfileParams = {}) =>
	api.get<StudentLearningProfile>(
		`/scoreboard/students/${userId}/profile` as ApiPath,
		{ params },
	);
