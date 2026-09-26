/**
 * 训练会话状态 — 单 store 替代 6 层 Context Provider。
 *
 * 消费者用 selector 精确订阅，避免全量重渲染：
 *   useTrainingStore((s) => s.messages)   // only re-renders on messages change
 *   useTrainingStore((s) => s.emotion4D)  // only re-renders on emotion change
 *
 * 这里只放**会话瞬态**（流式消息 / 情绪 / 头像 / 护理记录本地草稿 / bus 等）。
 * 服务端事实（patient / features / manifest / timeLimit / recordDetail）一律由
 * `TrainingDataContext` 从 RQ 原始 record 派生，本 store 不复制。
 */
import { create } from "zustand";
import type { MessageCorrectionState } from "@/engine/training-record-types";
import type { ChatMessage, MessageBus } from "@/engine/types";

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
	withdrawn: "var(--mantine-color-red-4)",
	defensive: "var(--mantine-color-orange-4)",
	anxious: "var(--mantine-color-violet-4)",
	neutral: "var(--mantine-color-gray-4)",
	relaxed: "var(--mantine-color-blue-4)",
	open: "var(--mantine-color-green-4)",
};

const EMOTION_4D_BORDER: Record<string, string> = {
	open_trusting: "var(--mantine-color-green-4)",
	trusting_anxious: "var(--mantine-color-blue-4)",
	irritated: "var(--mantine-color-orange-4)",
	anxious_cooperative: "var(--mantine-color-violet-4)",
	anxious_guarded: "var(--mantine-color-violet-4)",
	withdrawn: "var(--mantine-color-red-4)",
	defensive: "var(--mantine-color-orange-4)",
	relaxed: "var(--mantine-color-blue-4)",
	neutral: "var(--mantine-color-gray-4)",
};

export function getEmotionBorder(emotion: string): string {
	return EMOTION_4D_BORDER[emotion] || EMOTION_BORDER[emotion as EmotionState] || EMOTION_BORDER.neutral;
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


export type NursingRecordSheet = Record<string, string>;

export interface TrainingStore {
	bus: MessageBus | null;
	recordId: string;
	/** 消息修正额度：服务端下发 + 乐观修正后立即生效的本地投影（不是 recordDetail 副本） */
	messageCorrection: MessageCorrectionState | null;
	messages: ChatMessage[];
	sending: boolean;
	ttsAutoPlay: boolean;
	trainingEnded: boolean;
	emotion: EmotionState;
	trust: number;
	comfort: number;
	anxiety: number;
	irritation: number;
	cooperation: number;
	emotion4D: Emotion4DLabel;
	portraitUrl: string | null;
	nursingRecordDraft: NursingRecordSheet | null;
	nursingRecordDirty: boolean;
	/** 提交时间戳（ISO）；非 null = 内容已冻结、进入评分证据、编辑器只读 */
	nursingRecordSubmittedAt: string | null;

	init: (data: {
		bus: MessageBus;
		recordId: string;
		initialMessages: ChatMessage[];
		emotionSeed?: { trust: number; anxiety: number; irritation: number; cooperation: number; dominant_state?: string } | null;
		/** 会话瞬态的窄化种子（本地草稿 / 修正额度）：只从原始 record 取，不整份复制 */
		seed: {
			nursingRecordSheet: NursingRecordSheet | null;
			nursingRecordSubmittedAt: string | null;
			messageCorrection: MessageCorrectionState | null;
		};
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
	setEmotion: (e: EmotionState) => void;
	setTrustComfort: (trust: number, comfort: number) => void;
	setEmotion4D: (trust: number, anxiety: number, irritation: number, cooperation: number, label: Emotion4DLabel) => void;
	setPortraitUrl: (url: string | null) => void;
	hydrateNursingRecord: (sheet: NursingRecordSheet, meta?: { submitted_at?: string | null }) => void;
	updateNursingRecordField: (key: string, value: string) => void;
	markNursingRecordSaved: (savedSheet: NursingRecordSheet) => void;
	/** 提交成功：服务端冻结版本是唯一真值，直接覆盖本地草稿并进入只读态 */
	markNursingRecordSubmitted: (submittedSheet: NursingRecordSheet, submittedAt: string | null) => void;
	/** 重开草稿：解除冻结，学生可继续编辑 */
	markNursingRecordReopened: () => void;
}

const initialTrainingState = {
	bus: null,
	recordId: "",
	messageCorrection: null as MessageCorrectionState | null,
	messages: [] as ChatMessage[],
	sending: false,
	ttsAutoPlay: true,
	trainingEnded: false,
	emotion: "neutral" as EmotionState,
	trust: 50,
	comfort: 50,
	anxiety: 50,
	irritation: 50,
	cooperation: 50,
	emotion4D: "neutral" as Emotion4DLabel,
	portraitUrl: null as string | null,
	nursingRecordDraft: null as NursingRecordSheet | null,
	nursingRecordDirty: false,
	nursingRecordSubmittedAt: null as string | null,
};

export const useTrainingStore = create<TrainingStore>()((set, get) => ({
	...initialTrainingState,

	init(data) {
		const cur = get();
		const serverSheet = data.seed.nursingRecordSheet;
		const serverSubmittedAt = data.seed.nursingRecordSubmittedAt;
		const serverCorrection = data.seed.messageCorrection;
		// 同一记录的 RQ refetch / React 重挂载必须保留会话内消息，但也必须
		// 重新绑定本次 TrainingEngine 的 bus；否则工具仍向已卸载引擎的 bus 发消息。
		// 本地瞬态（未保存的草稿、乐观修正额度）优先于服务端快照，refetch 不得回退。
		if (cur.recordId === data.recordId) {
			// 修正额度以服务端为准（额度用尽 / 工具操作后失效必须立即看到），
			// 但刚完成、refetch 尚未包含的乐观修正不能被更早发起的响应回退。
			const localCorrection = cur.messageCorrection;
			set({
				bus: data.bus,
				messageCorrection:
					localCorrection && localCorrection.used > (serverCorrection?.used ?? -1)
						? localCorrection
						: (serverCorrection ?? localCorrection),
				nursingRecordDraft: cur.nursingRecordDirty
					? cur.nursingRecordDraft
					: (serverSheet ?? cur.nursingRecordDraft),
				nursingRecordSubmittedAt: serverSubmittedAt ?? cur.nursingRecordSubmittedAt,
			});
			return;
		}
		set({
			bus: data.bus,
			recordId: data.recordId,
			messages: data.initialMessages,
			sending: false,
			trainingEnded: false,
			// v2 六态/comfort 不再由种子驱动：后端 payload 只有 4D + dominant_state，
			// 会话恢复的唯一可信来源是下面的四维与 emotion4D。
			emotion: "neutral",
			trust: data.emotionSeed?.trust ?? 50,
			comfort: 50,
			anxiety: data.emotionSeed?.anxiety ?? 50,
			irritation: data.emotionSeed?.irritation ?? 50,
			cooperation: data.emotionSeed?.cooperation ?? 50,
			emotion4D: (data.emotionSeed?.dominant_state as Emotion4DLabel) ?? "neutral",
			messageCorrection: data.seed.messageCorrection,
			nursingRecordDraft: serverSheet,
			nursingRecordDirty: false,
			nursingRecordSubmittedAt: serverSubmittedAt,
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
			messageCorrection: {
				used: payload.corrections_used ?? s.messageCorrection?.used ?? 0,
				remaining: payload.corrections_remaining ?? s.messageCorrection?.remaining ?? 0,
				eligible_last_message_id: payload.student_id ?? null,
			},
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
	setEmotion(e) { set({ emotion: e }); },
	setTrustComfort(trust, comfort) {
		const norm = (v: number) => (v <= 1 ? Math.round(v * 100) : v);
		set({ trust: norm(trust), comfort: norm(comfort) });
	},
	setEmotion4D(trust, anxiety, irritation, cooperation, label) {
		// v3 后端 4D 为 0-1 浮点，UI 按 0-100 渲染——此处统一归一化（修复"情绪指示条无变动"）
		const norm = (v: number) => (v <= 1 ? Math.round(v * 100) : v);
		set({
			trust: norm(trust),
			anxiety: norm(anxiety),
			irritation: norm(irritation),
			cooperation: norm(cooperation),
			emotion4D: label,
		});
	},
	setPortraitUrl(url) { set({ portraitUrl: url }); },
	hydrateNursingRecord(sheet, meta) {
		set((s) => {
			const next: Partial<TrainingStore> = {};
			// 已提交（冻结）时服务端版本是唯一真值，本地草稿一律让位；
			// 否则保留未保存的本地编辑（不吞掉学生正在输入的内容）。
			if (meta?.submitted_at || !s.nursingRecordDirty) {
				next.nursingRecordDraft = sheet;
				next.nursingRecordDirty = false;
			}
			if (meta) next.nursingRecordSubmittedAt = meta.submitted_at ?? null;
			return next;
		});
	},
	updateNursingRecordField(key, value) {
		set((s) => ({
			nursingRecordDraft: { ...(s.nursingRecordDraft ?? {}), [key]: value },
			nursingRecordDirty: true,
		}));
	},
	markNursingRecordSaved(savedSheet) {
		set((s) => {
			if (JSON.stringify(s.nursingRecordDraft ?? {}) !== JSON.stringify(savedSheet)) return {};
			return { nursingRecordDirty: false };
		});
	},
	markNursingRecordSubmitted(submittedSheet, submittedAt) {
		set({
			nursingRecordDraft: submittedSheet,
			nursingRecordDirty: false,
			nursingRecordSubmittedAt: submittedAt,
		});
	},
	markNursingRecordReopened() {
		set({ nursingRecordSubmittedAt: null });
	},
}));

export function getTrainingState(): TrainingStore {
	return useTrainingStore.getState();
}
