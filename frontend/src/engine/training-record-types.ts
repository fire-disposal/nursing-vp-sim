import type { components } from "@/api/api-types.gen";

/**
 * 训练记录详情 — 以 OpenAPI 生成类型为准（TrainingDataContext 直用生成类型）。
 * 此处仅为 store/engine 消费补足"会话可变"字段的精化类型（全部可选），
 * 不再维护松散的手写结构。
 */
export type TrainingRecordDetail = components["schemas"]["TrainingRecordDetail"];

/** 会话可变字段的精化：message_correction/mode/hide_case_info 等 */
export interface SessionDetailFields {
	mode?: string;
	hide_case_info?: boolean;
	remaining_seconds?: number | null;
	required_inquiries?: string[];
	message_correction?: {
		used?: number;
		remaining?: number;
		eligible_last_message_id?: string | number | null;
	};
}

/** store 侧 recordDetail 视图：生成类型全字段可选 + 会话可变字段精化 */
export type SessionRecordDetail = Partial<TrainingRecordDetail> & SessionDetailFields;
