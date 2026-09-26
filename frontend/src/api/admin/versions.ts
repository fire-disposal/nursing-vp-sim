import type { ApiPath } from "../api-path";
import { api } from "../client";

export type AttributionDimension = "prompt" | "rubric" | "mapping" | "context";

export interface AttributionItem {
	identity: string;
	records: number;
	scored: number;
	avg_score: number | null;
	fallback_rate: number | null;
	first_seen: string | null;
	last_seen: string | null;
}

export interface AttributionResponse {
	by: AttributionDimension;
	window_days: number;
	truncated: boolean;
	totals: { records: number; identities: number };
	items: AttributionItem[];
}

/** 版本归因（只读）：按身份聚合记录数 / 平均分 / 兜底率。 */
export const getVersionAttribution = (params: {
	by: AttributionDimension;
	window_days: number;
}) =>
	api.get<AttributionResponse>("/admin/versions/attribution" satisfies ApiPath as string, {
		params,
	});
