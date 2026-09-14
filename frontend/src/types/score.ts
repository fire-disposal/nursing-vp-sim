/**
 * 评分载荷的唯一类型定义 —— 全前端（学生结果页 / 教师详情 / 评分卡 / 复核编辑器）
 * 共用此视图，不再各自手写第二/第三份结构。
 *
 * 后端 `score` 字段是弱类型 dict（OpenAPI 生成类型只给 `ScoreItem` 的
 * `detail_scores?: Record<string, unknown>`），因此由 `@/utils/score` 的
 * `toScoreData()` 作为唯一转换点收口。
 */

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
	/** 缺失场景：后端只落了自评分支路（见 ScoreManager 兜底） */
	total_score?: number;
	detail_scores?: Record<string, DetailScoreCategory>;
	strengths?: string[];
	weaknesses?: string[];
	missed_content?: string[];
	suggestions?: string;
	rubric_version?: string;
	review?: ScoreReviewData | null;
	/** Phase 1 契约：原始分/映射版本/兜底标记/复核写回分 */
	raw_total?: number | null;
	mapping_version?: number;
	fallback?: { kind?: string; dims?: string[] } | null;
	reviewed_total?: number | null;
	/** 复核信息（后端已随详情响应一次携带） */
	review_status?: string | null;
	reviewed_by_name?: string | null;
	reviewed_at?: string | null;
	review_comment?: string | null;
}
