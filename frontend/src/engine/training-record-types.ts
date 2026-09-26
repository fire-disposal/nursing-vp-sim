import type { components } from "@/api/api-types.gen";

/**
 * 训练记录详情 — 以 OpenAPI 生成类型为准（TrainingDataContext 直用生成类型）。
 * 此处仅为「生成类型里是 `unknown` 值」的会话可变字段提供窄化类型。
 */
export type TrainingRecordDetail = components["schemas"]["TrainingRecordDetail"];

/** 消息修正额度（`record.message_correction`）：服务端下发 + 乐观修正后的本地投影。 */
export interface MessageCorrectionState {
	used: number;
	remaining: number;
	eligible_last_message_id: string | number | null;
}

/** 会话可变字段的精化：message_correction/mode/hide_case_info 等 */
export interface SessionDetailFields {
	mode?: string;
	hide_case_info?: boolean;
	remaining_seconds?: number | null;
	required_inquiries?: string[];
	message_correction?: MessageCorrectionState;
	/** 提交时间戳：非空 = 内容已冻结并进入评分；空 = 未提交（不参与评分） */
	nursing_record_submitted_at?: string | null;
	/** 终端原因：user_end / timeout / patient_walkout */
	terminal_reason?: string | null;
}
