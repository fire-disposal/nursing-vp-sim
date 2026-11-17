/**
 * 演示电话 — 引擎层的公共类型。
 *
 * 这一层是**独立演示**：没有训练记录、没有 LLM、没有评分。所有"病人反应"来自
 * `script.ts` 的确定性脚本 + `emotion.ts` 的四维状态机，因此同样的输入永远得到同样的输出。
 */

/** 四维情绪向量（0..1）。与训练链路的语义同名，但这里只有演示脚本能改它。 */
export interface EmotionVector {
	/** 信任。 */
	trust: number;
	/** 焦虑。 */
	anxiety: number;
	/** 烦躁。 */
	irritation: number;
	/** 配合度。 */
	cooperation: number;
}

export type EmotionDim = keyof EmotionVector;

/**
 * 主导情绪标签 —— 沿用后端情绪口径（9 态），因为 TTS 服务的 `emotion_state`
 * 与 `emotion context_texts` 按这套键取值；演示页不另造一套词汇。
 */
export type PhoneEmotionLabel =
	| "open_trusting"
	| "trusting_anxious"
	| "irritated"
	| "anxious_cooperative"
	| "anxious_guarded"
	| "withdrawn"
	| "defensive"
	| "relaxed"
	| "neutral";

export const PHONE_EMOTION_LABELS: Record<PhoneEmotionLabel, string> = {
	open_trusting: "开放信任",
	trusting_anxious: "信任但焦虑",
	irritated: "烦躁抵触",
	anxious_cooperative: "焦虑但配合",
	anxious_guarded: "焦虑戒备",
	withdrawn: "沉默回避",
	defensive: "防御抵触",
	relaxed: "放松配合",
	neutral: "正常交流",
};

/** 对话阶段（只用于展示，不驱动任何后端语义）。 */
export type PhoneStage =
	| "idle"
	| "greeting"
	| "listening"
	| "user_speaking"
	| "patient_speaking"
	| "waiting_reply"
	| "ended";

export const PHONE_STAGE_LABELS: Record<PhoneStage, string> = {
	idle: "未开始",
	greeting: "接通与开场",
	listening: "等待你说话",
	user_speaking: "正在听你说话",
	patient_speaking: "对方回复中",
	waiting_reply: "等待对方回复",
	ended: "通话结束",
};

/**
 * 学生这句话的意图（纯本地正则判定，只用于情绪加权与界面标签）。
 * 不限制对话内容：未命中任何规则的输入一律落到 `other`。
 */
export type ScriptIntent = "greeting" | "emotion_probe" | "empathy" | "question" | "other";

export const USER_INTENT_LABELS: Record<ScriptIntent, string> = {
	greeting: "问候",
	emotion_probe: "情绪询问",
	empathy: "共情回应",
	question: "提问",
	other: "一般表达",
};

/** 事件日志条目（电话页中栏的"事件日志"）。 */
export interface PhoneLogEntry {
	id: number;
	at: number;
	kind: "user" | "patient" | "emotion" | "system" | "asr" | "tts" | "error";
	text: string;
}
