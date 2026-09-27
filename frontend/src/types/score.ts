/**
 * 评分载荷的唯一类型定义 —— 全前端（学生结果页 / 教师详情 / 评分卡 / 复核编辑器）
 * 共用此视图，不再各自手写第二/第三份结构。
 *
 * 后端 `score` 字段是弱类型 dict（OpenAPI 生成类型只给 `ScoreItem` 的
 * `detail_scores?: Record<string, unknown>`），因此由 `@/utils/score` 的
 * `toScoreData()` 作为唯一转换点收口。
 *
 * 两层精度（docs/19 §4.2）：
 * - **展示层** `detail_scores`：条目分已换算到 display 量尺（≈0-5），用于进度条与分母；
 * - **原始层** `raw_detail_scores`：未换算的逐项判定（0..raw_scale，`score` 可为 null），
 *   逐项判定理由/证据/状态只认这一层。
 */

/** 有效成绩来源：AI 初评 / 教师复核 / 系统降级（服务端给定，前端不自行判定） */
export type ScoreSource = "ai" | "review" | "fallback";

/** 条目判定状态：已判定 / 本次不适用 / 模型未判定 */
export type ItemStatus = "scored" | "not_applicable" | "unscored_by_model";

/** 证据引用：可定位到既有消息 / 动作 / 提交产物（服务端确定性解析结果） */
export interface EvidenceRef {
	kind: "message" | "action" | "artifact";
	id: number | string;
	/** kind=message：说话人角色 */
	role?: string | null;
	/** kind=action：动作类型 */
	action?: string | null;
}

interface ScoreItemBase {
	id?: number | string;
	name: string;
	max?: number;
	status?: ItemStatus;
	evidence?: string;
	reason?: string;
	evidence_refs?: EvidenceRef[];
	/** 服务端是否在既有记录中定位到该证据；false = 未能定位证据 */
	evidence_verified?: boolean;
}

/** 展示层条目：分数已换算，必定是数值 */
export interface ScoreItemData extends ScoreItemBase {
	score: number;
}

/** 原始层条目：未换算，`score` 为 null 表示本次不适用等非数值判定 */
export interface RawScoreItemData extends ScoreItemBase {
	score: number | null;
}

export interface DetailScoreCategory {
	score: number;
	max: number;
	items?: ScoreItemData[];
}

/** 原始层维度：`score` 为 null = 该维度没有可评条目 */
export interface RawDetailScoreCategory {
	score: number | null;
	max: number;
	items?: RawScoreItemData[];
}

export interface ScoreReviewData {
	detail_scores?: Record<string, unknown> | null;
	total_score?: number | null;
	comment?: string | null;
	reviewed_at?: string | null;
}

/** 系统降级标记：非 null 即「这次结果不是正常评分」 */
export type ScoreFallbackKind =
	| "llm_empty"
	| "llm_partial"
	| "dims_injected"
	| "items_unscored"
	| "all_dims_injected"
	| "no_applicable_items";

export interface ScoreFallback {
	kind?: ScoreFallbackKind | string;
	/** kind=items_unscored：未判定的条目 */
	items?: string[];
	/** kind=dims_injected / all_dims_injected：被注入的维度 */
	dims?: string[];
}

/** 评分溯源元数据（量尺身份、适用分母、政策身份、辅助条件） */
export interface ScoreMeta {
	applicable_raw_max?: number | null;
	not_applicable_items?: string[];
	rubric_content_id?: string | null;
	scoring_prompt_id?: string | null;
	feedback_prompt_id?: string | null;
	grade_policy?: { id?: string; version?: number } | null;
	assistance?: { mode?: string | null } | null;
	/** 为什么 weaknesses/missed_content 为空（服务端给的解释） */
	feedback_note?: string | null;
}

export interface GradePolicyNumericBand {
	band: string;
	min: number;
	label: string;
}

/** 等第政策身份：未校准时能力类字段为空，能力等第不可用 */
export interface GradePolicy {
	id?: string;
	version?: number;
	calibrated?: boolean;
	capability_available?: boolean;
	capability_label?: string | null;
	capability_note?: string | null;
	numeric_bands?: GradePolicyNumericBand[];
	numeric_band_description?: string;
}

/** 成绩解释视图（服务端唯一来源）：数值分层 ≠ 能力等第 */
export interface ScoreGrade {
	numeric_band?: string;
	numeric_band_label?: string;
	capability_band?: string | null;
	capability_label?: string | null;
	source?: ScoreSource | string;
	policy?: GradePolicy;
}

export interface ScoreData {
	/** AI 初评展示分（0-100 量尺） */
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
	fallback?: ScoreFallback | null;
	reviewed_total?: number | null;
	/** 有效成绩 = COALESCE(reviewed_total, total_score)（服务端给定） */
	effective_total?: number | null;
	/** 有效成绩来源（服务端给定；历史行缺失时才由 utils 依据字段推导） */
	source?: ScoreSource | string | null;
	grade?: ScoreGrade | null;
	/** 原始层逐项判定（未换算量尺） */
	raw_detail_scores?: Record<string, RawDetailScoreCategory> | null;
	score_meta?: ScoreMeta | null;
	/** 空反馈的解释（为什么 weaknesses/missed_content 为空） */
	feedback_note?: string | null;
	/** 复核信息（后端已随详情响应一次携带） */
	review_status?: string | null;
	reviewed_by_name?: string | null;
	reviewed_at?: string | null;
	review_comment?: string | null;
}
