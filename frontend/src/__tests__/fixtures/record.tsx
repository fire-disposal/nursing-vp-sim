import type { ReactNode } from "react";
import { TrainingDataProvider } from "@/engine/TrainingDataContext";
import type { TrainingRecordDetail } from "@/engine/training-record-types";

/**
 * 测试用的原始 record 构造器 —— 与 `TrainingEntry` 的 RQ 查询返回同形。
 * 训练叶子组件只从 `TrainingDataContext` 读病例事实，测试必须喂同一份原始数据。
 */
export function makeRecord(overrides: Partial<TrainingRecordDetail> = {}): TrainingRecordDetail {
	return {
		id: 1,
		case_id: 1,
		case_name: "测试病例",
		user_display_name: "学生",
		status: "in_progress",
		start_time: "2026-09-25T00:00:00+00:00",
		end_time: null,
		time_limit: 20,
		mode: "guided",
		hide_case_info: false,
		messages: [],
		patient_gender: "男",
		patient_name: "王建国",
		patient_age: 68,
		chief_complaint: "喘不上气",
		case_title: "慢阻肺",
		from_assignment: false,
		pending_questionnaires: 0,
		initiative_count: 0,
		is_test: false,
		...overrides,
	};
}

/** 用原始 record 包住被测组件（`null` = 查询尚未返回）。 */
export function withTrainingData(node: ReactNode, record: TrainingRecordDetail | null) {
	return <TrainingDataProvider value={record}>{node}</TrainingDataProvider>;
}
