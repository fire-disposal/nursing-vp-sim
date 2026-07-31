/**
 * 训练会话状态 — 单 store 替代 6 层 Context Provider。
 *
 * 消费者用 selector 精确订阅，避免全量重渲染：
 *   useTrainingStore((s) => s.messages)   // only re-renders on messages change
 *   useTrainingStore((s) => s.patient)    // only re-renders on patient change
 */
import { create } from "zustand";
import type { ChatMessage, MessageBus, PatientData } from "@/engine/types";
import type { TrainingRecordDetail } from "@/engine/training-record-types";

export type EmotionState =
	| "withdrawn"
	| "defensive"
	| "anxious"
	| "neutral"
	| "relaxed"
	| "open";

// ── 四维情绪标签（向后兼容旧的六标签） ──
export type Emotion4DLabel =
	| "open_trusting"
	| "trusting_anxious"
	| "irritated"
	| "anxious_cooperative"
	| "anxious_guarded"
	| "withdrawn"
	| "defensive"
	| "relaxed"
	| "neutral";

export const EMOTION_LABELS: Record<EmotionState, string> = {
	withdrawn: "沉默回避",
	defensive: "防御抵触",
	anxious: "焦虑不安",
	neutral: "正常配合",
	relaxed: "放松友好",
	open: "开放信任",
};

export const EMOTION_4D_LABELS: Record<Emotion4DLabel, string> = {
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

const EMOTION_BORDER: Record<EmotionState, string> = {
	withdrawn: "border-red-400",
	defensive: "border-orange-400",
	anxious: "border-purple-400",
	neutral: "border-border",
	relaxed: "border-blue-400",
	open: "border-green-400",
};
const EMOTION_COLOR: Record<EmotionState, string> = {
	withdrawn: "text-red-600",
	defensive: "text-orange-600",
	anxious: "text-purple-600",
	neutral: "text-muted-foreground",
	relaxed: "text-blue-600",
	open: "text-green-600",
};

const EMOTION_4D_BORDER: Record<string, string> = {
	open_trusting: "border-green-400",
	trusting_anxious: "border-blue-400",
	irritated: "border-orange-400",
	anxious_cooperative: "border-purple-400",
	anxious_guarded: "border-purple-400",
	withdrawn: "border-red-400",
	defensive: "border-orange-400",
	relaxed: "border-blue-400",
	neutral: "border-border",
};

export function getEmotionBorder(emotion: string): string {
	return EMOTION_4D_BORDER[emotion] || EMOTION_BORDER[emotion as EmotionState] || EMOTION_BORDER.neutral;
}

export function getEmotionColor(emotion: string): string {
	return EMOTION_COLOR[emotion as EmotionState] || EMOTION_COLOR.neutral;
}
interface CorrectionSnapshot {
	messages: ChatMessage[];
	studentId: string | number;
	placeholderId: string;
}

interface CorrectionDonePayload {
	student_id?: number;
	patient_id?: number;
	corrections_used?: number;
	corrections_remaining?: number;
}


export interface TrainingStore {
	bus: MessageBus | null;
	recordId: string;
	patient: PatientData | null;
	trainingType: string;
	capabilities: Record<string, boolean>;
	timeLimitMinutes: number;
	recordDetail: TrainingRecordDetail | null;
	messages: ChatMessage[];
	sending: boolean;
	ttsAutoPlay: boolean;
	voiceStatus: { provider: string; latencyMs: number } | null;
	/** ISO 时间戳：训练创建时刻，倒计时以此为基准（服务端同一语义） */
	startTime: string | null;
	trainingEnded: boolean;
	emotion: EmotionState;
	trust: number;
	comfort: number;
	anxiety: number;
	irritation: number;
	cooperation: number;
	emotion4D: Emotion4DLabel;
	portraitUrl: string | null;

	init: (data: {
		bus: MessageBus;
		recordId: string;
		patient: PatientData;
		trainingType: string;
		capabilities: Record<string, boolean>;
		timeLimitMinutes: number;
		recordDetail: TrainingRecordDetail | null;
		initialMessages: ChatMessage[];
		startTime: string | null;
		emotionSeed?: { trust: number; comfort: number; state: string } | null;
	}) => void;
	reset: () => void;

	setMessages: (msgs: ChatMessage[]) => void;
	addStudentMessage: (content: string) => { studentId: string; placeholderId: string };
	beginCorrection: (messageId: string | number, content: string) => CorrectionSnapshot | null;
	finalizeCorrection: (snapshot: CorrectionSnapshot, payload: CorrectionDonePayload) => void;
	rollbackCorrection: (snapshot: CorrectionSnapshot) => void;
	appendChunk: (placeholderId: string, chunk: string) => void;
	finalizeMessage: (placeholderId: string, serverId?: number) => void;
	handleStreamError: (studentId: string, placeholderId: string, err: string, hasContent: boolean) => void;
	mergeHistory: (incoming: ChatMessage[]) => number;

	setSending: (v: boolean) => void;
	setTrainingEnded: (v: boolean) => void;
	setTtsAutoPlay: (v: boolean) => void;
	toggleTts: () => void;
	setVoiceStatus: (s: { provider: string; latencyMs: number } | null) => void;
	setEmotion: (e: EmotionState) => void;
	setTrustComfort: (trust: number, comfort: number) => void;
	setEmotion4D: (trust: number, anxiety: number, irritation: number, cooperation: number, label: Emotion4DLabel) => void;
	setPortraitUrl: (url: string | null) => void;
}

const initialTrainingState = {
	bus: null,
	recordId: "",
	patient: null,
	trainingType: "history_taking",
	capabilities: {} as Record<string, boolean>,
	timeLimitMinutes: 20,
	recordDetail: null,
	messages: [] as ChatMessage[],
	sending: false,
	ttsAutoPlay: true,
	voiceStatus: null as { provider: string; latencyMs: number } | null,
	startTime: null as string | null,
	trainingEnded: false,
	emotion: "neutral" as EmotionState,
	trust: 50,
	comfort: 50,
	anxiety: 50,
	irritation: 50,
	cooperation: 50,
	emotion4D: "neutral" as Emotion4DLabel,
	portraitUrl: null as string | null,
};

export const useTrainingStore = create<TrainingStore>()((set, get) => ({
	...initialTrainingState,

	init(data) {
		set({
			bus: data.bus,
			recordId: data.recordId,
			patient: data.patient,
			trainingType: data.trainingType,
			capabilities: data.capabilities,
			timeLimitMinutes: data.timeLimitMinutes,
			recordDetail: data.recordDetail,
			startTime: data.startTime,
			messages: data.initialMessages,
			sending: false,
			trainingEnded: false,
			emotion: (data.emotionSeed?.state &&
				Object.hasOwn(EMOTION_LABELS, data.emotionSeed.state))
				? (data.emotionSeed.state as EmotionState)
				: "neutral",
			trust: data.emotionSeed?.trust ?? 50,
			comfort: data.emotionSeed?.comfort ?? 50,
			anxiety: 50,
			irritation: 50,
			cooperation: 50,
			emotion4D: "neutral" as Emotion4DLabel,
		});
	},

	reset() {
		set({ ...initialTrainingState });
	},

	setMessages(msgs) {
		set({ messages: msgs });
	},

	addStudentMessage(content) {
		const studentId = crypto.randomUUID();
		const placeholderId = crypto.randomUUID();
		set((s) => ({
			messages: [
				...s.messages,
				{ id: studentId, role: "student", content },
				{ id: placeholderId, role: "patient", content: "", streaming: true },
			],
		}));
		return { studentId, placeholderId };
	},

	beginCorrection(messageId, content) {
		const messages = get().messages;
		const idx = messages.findIndex((m) => String(m.id) === String(messageId));
		if (idx < 0 || messages[idx]?.role !== "student") return null;
		const next = messages[idx + 1];
		if (idx !== messages.length - 2 || next?.role !== "patient") return null;
		const placeholderId = crypto.randomUUID();
		const snapshot = {
			messages,
			studentId: messageId,
			placeholderId,
		};
		set({
			messages: [
				...messages.slice(0, idx),
				{ ...messages[idx], content },
				{ id: placeholderId, role: "patient", content: "", streaming: true },
			],
		});
		return snapshot;
	},

	finalizeCorrection(snapshot, payload) {
		set((s) => ({
			messages: s.messages.map((m) => {
				if (String(m.id) === String(snapshot.studentId) && payload.student_id) {
					return { ...m, id: String(payload.student_id) };
				}
				if (m.id === snapshot.placeholderId) {
					return {
						...m,
						streaming: false,
						...(payload.patient_id ? { id: String(payload.patient_id) } : {}),
					};
				}
				return m;
			}),
			recordDetail: s.recordDetail
				? {
						...s.recordDetail,
						message_correction: {
							...(s.recordDetail.message_correction ?? {}),
							...(payload.corrections_used !== undefined
								? { used: payload.corrections_used }
								: {}),
							...(payload.corrections_remaining !== undefined
								? { remaining: payload.corrections_remaining }
								: {}),
							eligible_last_message_id: payload.student_id ?? null,
						},
					}
				: s.recordDetail,
			sending: false,
		}));
	},

	rollbackCorrection(snapshot) {
		set({ messages: snapshot.messages, sending: false });
	},

	appendChunk(placeholderId, chunk) {
		set((s) => ({
			messages: s.messages.map((m) =>
				m.id === placeholderId ? { ...m, content: m.content + chunk } : m,
			),
		}));
	},

	finalizeMessage(placeholderId, serverId) {
		set((s) => ({
			messages: s.messages.map((m) =>
				m.id === placeholderId
					? { ...m, streaming: false, ...(serverId ? { id: String(serverId) } : {}) }
					: m,
			),
			sending: false,
		}));
	},

	handleStreamError(studentId, placeholderId, err, hasContent) {
		set((s) => {
			if (hasContent) {
				return {
					messages: s.messages.map((m) =>
						m.id === placeholderId ? { ...m, streaming: false, streamError: err } : m,
					),
					sending: false,
				};
			}
			return {
				messages: s.messages.filter(
					(m) => m.id !== placeholderId && m.id !== studentId,
				),
				sending: false,
			};
		});
	},

	mergeHistory(incoming) {
		if (incoming.length === 0) return 0;
		const { messages } = get();
		const existingIds = new Set(
			messages.map((m) => m.id).filter((id) => id != null).map(String),
		);
		const existingContent = new Set(
			messages.map((m) => `${m.role}:${m.content}`),
		);
		const fresh = incoming.filter((m) => {
			if (m.id != null && existingIds.has(String(m.id))) return false;
			if (existingContent.has(`${m.role}:${m.content}`)) return false;
			return true;
		});
		if (fresh.length === 0) return 0;
		set({ messages: [...messages, ...fresh] });
		return fresh.length;
	},

	setSending(v) { set({ sending: v }); },
	setTrainingEnded(v) { set({ trainingEnded: v }); },
	setTtsAutoPlay(v) { set({ ttsAutoPlay: v }); },
	toggleTts() { set((s) => ({ ttsAutoPlay: !s.ttsAutoPlay })); },
	setVoiceStatus(s) { set({ voiceStatus: s }); },
	setEmotion(e) { set({ emotion: e }); },
	setTrustComfort(trust, comfort) { set({ trust, comfort }); },
	setEmotion4D(trust, anxiety, irritation, cooperation, label) { set({ trust, anxiety, irritation, cooperation, emotion4D: label }); },
	setPortraitUrl(url) { set({ portraitUrl: url }); },
}));

export function getTrainingState(): TrainingStore {
	return useTrainingStore.getState();
}
