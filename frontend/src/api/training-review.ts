import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

/**
 * `GET /training/records/{id}/review` —— 教师复核的**原始条目层**与基准来源。
 *
 * 复核编辑器只消费这个响应里的 `original_raw_detail_scores` + `raw_scale`
 * （不是展示层 `score.detail_scores`）：教师改的是原始刻度条目，展示分与复核分
 * 由服务端按同一映射算出。
 */
export const getRecordReview = (recordId: number | string) =>
	api.get<Schemas["ScoreReviewResponse"]>(
		`/training/records/${recordId}/review` as ApiPath,
	);

/** 复核数据的查询键（随 `api/training-review.ts` 走，避免与详情键混用）。 */
export const recordReviewQueryKey = (recordId: number | string) =>
	["training", "review", String(recordId)] as const;
