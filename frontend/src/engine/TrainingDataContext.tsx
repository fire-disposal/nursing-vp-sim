import { createContext, useContext, useMemo } from "react";
import type { components } from "@/api/api-types.gen";
import { type SessionManifest, parseSessionManifest } from "./manifest";
import type { MessageCorrectionState } from "./training-record-types";
import type { ChatMessage, PatientData } from "./types";

// ── Raw record from API (single source of truth) ──

type TrainingRecord = components["schemas"]["TrainingRecordDetail"];

const EMPTY_FEATURES: Record<string, boolean> = {};
const EMPTY_INQUIRIES: string[] = [];
const EMPTY_EXAM_RESULTS: ExamResultEntry[] = [];
const DEFAULT_META: RecordMeta = {
  mode: "guided",
  hideCaseInfo: false,
  remainingSeconds: null,
  requiredInquiries: EMPTY_INQUIRIES,
};

const TrainingDataCtx = createContext<TrainingRecord | null>(null);

export function TrainingDataProvider({
  value,
  children,
}: {
  value: TrainingRecord | null;
  children: React.ReactNode;
}) {
  return (
    <TrainingDataCtx.Provider value={value}>
      {children}
    </TrainingDataCtx.Provider>
  );
}

/** 原始查询数据（RQ record detail）。派生 hook 全部只读它这一份，不复制到别处。 */
export function useTrainingData(): TrainingRecord | null {
  return useContext(TrainingDataCtx);
}

// ── 窄化工具：服务端字段是 JSON（`[key: string]: unknown`），逐个收敛 ──

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ── Derived: PatientData ──

export function usePatientData(): PatientData | null {
  const record = useTrainingData();
  return useMemo(() => {
    if (!record) return null;
    const d = record as Record<string, unknown>;
    const rawGender = (d.patient_gender as string) || String((d.patient_info as Record<string, unknown> | undefined)?.gender || "男");
    const gender: "male" | "female" = rawGender === "男" ? "male" : "female";
    return {
      name: (d.patient_name as string) ?? (d.case as { name?: string } | undefined)?.name ?? "患者",
      age: (d.patient_age as number) ?? (d.case as { age?: number } | undefined)?.age ?? 0,
      gender,
      caseTitle: (d.case_title as string) ?? (d.case as { title?: string } | undefined)?.title ?? "",
      chiefComplaint: (d.chief_complaint as string) ?? (d.case as { chief_complaint?: string } | undefined)?.chief_complaint ?? "",
    };
  }, [record]);
}

// ── Derived: initial messages ──

export function useInitialMessages(): ChatMessage[] {
  const record = useTrainingData();
  return useMemo(() => {
    if (!record?.messages) return [];
    return record.messages.map((m) => ({
      id: String(m.id),
      role: (m.role === "student" || m.role === "patient" ? m.role : "system") as ChatMessage["role"],
      content: m.content,
    }));
  }, [record]);
}

// ── Derived: builtin features ──

/**
 * 内置特性开关（emotion / patient_initiative / inquiry_progress）。
 *
 * **不是**能力表：Activity 的可用性一律读 `manifest.activities[].availability`，
 * 这里只服务于内核内置的 UI 行为（情绪指示器、主动追问提示）。
 */
export function useRecordFeatures(): Record<string, boolean> {
  const record = useTrainingData();
  return useMemo(() => record?.features ?? EMPTY_FEATURES, [record]);
}

// ── Derived: parsed session manifest ──

/**
 * 服务端解析出的会话 manifest：Activity 可用性 / 产物 / 完成条件的唯一来源。
 *
 * 直接解析原始 record 的 `manifest` 字段，不在 store 里复制第二份
 * （否则 RQ refetch 与本地副本会形成双真相）。
 */
export function useSessionManifest(): SessionManifest | null {
  const record = useTrainingData();
  return useMemo(() => parseSessionManifest(record?.manifest), [record]);
}

// ── Derived: record metadata（模式 / 盲盒 / 倒计时锚点 / 问诊清单） ──

export interface RecordMeta {
  mode: string;
  hideCaseInfo: boolean;
  remainingSeconds: number | null;
  requiredInquiries: string[];
}

export function useRecordMeta(): RecordMeta {
  const record = useTrainingData();
  return useMemo(() => {
    if (!record) return DEFAULT_META;
    return {
      mode: record.mode || "guided",
      hideCaseInfo: record.hide_case_info === true,
      remainingSeconds: optionalNumber(record.remaining_seconds),
      requiredInquiries: record.required_inquiries ?? EMPTY_INQUIRIES,
    };
  }, [record]);
}

// ── Derived: message correction（服务端额度；乐观修正后的本地投影在 store） ──

/** 服务端下发的修正额度快照（`record.message_correction`）。 */
export function useMessageCorrection(): MessageCorrectionState | null {
  const record = useTrainingData();
  return useMemo(() => {
    const raw = record?.message_correction;
    if (!raw || typeof raw !== "object") return null;
    const eligible = raw.eligible_last_message_id;
    return {
      used: optionalNumber(raw.used) ?? 0,
      remaining: optionalNumber(raw.remaining) ?? 0,
      eligible_last_message_id:
        typeof eligible === "string" || typeof eligible === "number" ? eligible : null,
    };
  }, [record]);
}

// ── Derived: persisted physical-exam results ──

export interface ExamResultEntry {
  type: string;
  label?: string;
  value: string;
  unit?: string;
  status?: string;
  interpretation?: string;
}

/** 已写入记录的查体结果（`record.exam_results`），窄化掉 `unknown` 值。 */
export function useExamResults(): ExamResultEntry[] {
  const record = useTrainingData();
  return useMemo(() => {
    const raw = record?.exam_results;
    if (!Array.isArray(raw)) return EMPTY_EXAM_RESULTS;
    const parsed: ExamResultEntry[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const type = optionalString(item.type);
      if (!type) continue;
      parsed.push({
        type,
        label: optionalString(item.label),
        value: item.value == null ? "" : String(item.value),
        unit: optionalString(item.unit),
        status: optionalString(item.status),
        interpretation: optionalString(item.interpretation),
      });
    }
    return parsed;
  }, [record]);
}

// ── Derived: nursing-record seed（本地草稿的起点，草稿本身在 store） ──

export interface NursingRecordSeed {
  sheet: Record<string, string> | null;
  submittedAt: string | null;
}

/** 服务端护理记录的快照：只用于初始化/刷新会话内的本地草稿。 */
export function useNursingRecordSeed(): NursingRecordSeed {
  const record = useTrainingData();
  return useMemo(() => {
    const raw = record?.nursing_record_sheet;
    let sheet: Record<string, string> | null = null;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      sheet = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          sheet[key] = String(value);
        }
      }
    }
    return { sheet, submittedAt: record?.nursing_record_submitted_at ?? null };
  }, [record]);
}

// ── Derived: emotion/scene seed data (was _restoreRecord in TrainingEngine) ──

/**
 * v3 情绪种子 —— 后端 `record.emotion` 的唯一契约
 * （`serialize_emotion_vector`：0-100 四维 + dominant_state 标签）。
 */
export interface EmotionSeed {
	trust: number;
	anxiety: number;
	irritation: number;
	cooperation: number;
	dominant_state: string;
}

export function useEmotionSeed(): EmotionSeed | null {
	const record = useTrainingData();
	return useMemo(() => {
		if (!record) return null;
		const em = record.emotion;
		if (
			em &&
			typeof em.trust === "number" &&
			typeof em.anxiety === "number" &&
			typeof em.irritation === "number" &&
			typeof em.cooperation === "number"
		) {
			return {
				trust: em.trust,
				anxiety: em.anxiety,
				irritation: em.irritation,
				cooperation: em.cooperation,
				dominant_state: typeof em.dominant_state === "string" ? em.dominant_state : "neutral",
			};
		}
		return null;
	}, [record]);
}

export function useRecordStatus(): string | undefined {
  const record = useTrainingData();
  return record?.status;
}
