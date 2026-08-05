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

export const getScoreboardRanking = (params: ScoreboardRankingParams = {}) =>
	api.get<Schemas["ScoreboardRankingResponse"]>(
		"/scoreboard/ranking" satisfies ApiPath as string,
		{ params },
	);

export const getStudentTrend = (
	userId: number,
	params: Omit<ScoreboardRankingParams, "search" | "sort_by" | "order" | "tier" | "offset" | "limit"> = {},
) =>
	api.get<Schemas["StudentTrendResponse"]>(
		`/scoreboard/students/${userId}/trend` as ApiPath,
		{ params },
	);
