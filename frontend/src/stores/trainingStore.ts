/**
 * 训练会话状态 — 单 store 替代 6 层 Context Provider。
 *
 * 消费者用 selector 精确订阅，避免全量重渲染：
 *   useTrainingStore((s) => s.messages)   // only re-renders on messages change
 *   useTrainingStore((s) => s.patient)    // only re-renders on patient change
 */
import { create } from "zustand";
import type { ChatMessage, MessageBus, PatientData } from "@/engine/types";
import type { TrainingRecordDetail } from "@/engine/TrainingContext";

export type EmotionState =
	| "withdrawn"
	| "defensive"
	| "anxious"
	| "neutral"
	| "relaxed"
	| "open";

export const EMOTION_LABELS: Record<EmotionState, string> = {
	withdrawn: "沉默回避",
	defensive: "防御抵触",
	anxious: "焦虑不安",
	neutral: "正常配合",
	relaxed: "放松友好",
	open: "开放信任",
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

export function getEmotionBorder(emotion: EmotionState): string {
	return EMOTION_BORDER[emotion] || EMOTION_BORDER.neutral;
}

export function getEmotionColor(emotion: EmotionState): string {
	return EMOTION_COLOR[emotion] || EMOTION_COLOR.neutral;
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
	remainingSeconds: number | null;
	trainingEnded: boolean;
	emotion: EmotionState;
	trust: number;
	comfort: number;
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
		remainingSeconds: number | null;
		emotionSeed?: { trust: number; comfort: number; state: string } | null;
	}) => void;
	reset: () => void;

	setMessages: (msgs: ChatMessage[]) => void;
	addStudentMessage: (content: string) => { studentId: string; placeholderId: string };
	appendChunk: (placeholderId: string, chunk: string) => void;
	finalizeMessage: (placeholderId: string, serverId?: number) => void;
	handleStreamError: (studentId: string, placeholderId: string, err: string, hasContent: boolean) => void;
	mergeHistory: (incoming: ChatMessage[]) => number;

	setSending: (v: boolean) => void;
	setTrainingEnded: (v: boolean) => void;
	setTtsAutoPlay: (v: boolean) => void;
	toggleTts: () => void;
	setVoiceStatus: (s: { provider: string; latencyMs: number } | null) => void;
	setRemainingSeconds: (s: number | null) => void;
	setEmotion: (e: EmotionState) => void;
	setTrustComfort: (trust: number, comfort: number) => void;
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
	remainingSeconds: null as number | null,
	trainingEnded: false,
	emotion: "neutral" as EmotionState,
	trust: 50,
	comfort: 50,
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
			remainingSeconds: data.remainingSeconds,
			messages: data.initialMessages,
			sending: false,
			trainingEnded: false,
			emotion: (data.emotionSeed?.state &&
				Object.hasOwn(EMOTION_LABELS, data.emotionSeed.state))
				? (data.emotionSeed.state as EmotionState)
				: "neutral",
			trust: data.emotionSeed?.trust ?? 50,
			comfort: data.emotionSeed?.comfort ?? 50,
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
	toggleTts() {
		set((s) => ({ ttsAutoPlay: !s.ttsAutoPlay }));
	},
	setVoiceStatus(s) { set({ voiceStatus: s }); },
	setRemainingSeconds(s) { set({ remainingSeconds: s }); },
	setEmotion(e) { set({ emotion: e }); },
	setTrustComfort(trust, comfort) { set({ trust, comfort }); },
	setPortraitUrl(url) { set({ portraitUrl: url }); },
}));

export function getTrainingState(): TrainingStore {
	return useTrainingStore.getState();
}
