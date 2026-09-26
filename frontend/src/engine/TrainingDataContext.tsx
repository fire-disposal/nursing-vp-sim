import { createContext, useContext, useMemo } from "react";
import type { components } from "@/api/api-types.gen";
import type { ChatMessage, PatientData } from "./types";
import type { TrainingRecordDetail } from "./training-record-types";

// ── Raw record from API (single source of truth) ──

type TrainingRecord = components["schemas"]["TrainingRecordDetail"];
const EMPTY_FEATURES: Record<string, boolean> = {};


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

export function useTrainingData(): TrainingRecord | null {
  return useContext(TrainingDataCtx);
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

// ── Derived: time limit / countdown anchor ──

export function useTimeLimit(): number {
  const record = useTrainingData();
  return record?.time_limit ?? 20;
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

export function useRecordAsDetail(): TrainingRecordDetail | null {
  const record = useTrainingData();
  return record as TrainingRecordDetail | null;
}
