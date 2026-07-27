import { createContext, useContext, useMemo } from "react";
import type { components } from "@/api/api-types.gen";
import type { ChatMessage, PatientData } from "./types";
import type { TrainingRecordDetail } from "./TrainingContext";

// ── Raw record from API (single source of truth) ──

type TrainingRecord = components["schemas"]["TrainingRecordDetail"];

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
      personality: (d.personality as string) ?? (d.case as { personality?: string } | undefined)?.personality ?? "",
      requiredInquiries: (d.required_inquiries as string[]) ?? [],
      examAnchors: (d.exam_anchors as Record<string, unknown>) ?? {},
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

// ── Derived: capabilities ──

export function useRecordCapabilities(): Record<string, boolean> {
  const record = useTrainingData();
  return useMemo(() => record?.features ?? {}, [record]);
}

// ── Derived: training type ──

export function useTrainingType(): string {
  const record = useTrainingData();
  return record?.training_type || "history_taking";
}

// ── Derived: time limit / remaining ──

export function useTimeLimit(): number {
  const record = useTrainingData();
  return record?.time_limit ?? 20;
}

export function useRemainingSeconds(): number | null {
  const record = useTrainingData();
  return record?.remaining_seconds ?? null;
}

// ── Derived: emotion/scene seed data (was _restoreRecord in TrainingEngine) ──

export function useEmotionSeed(): { trust: number; comfort: number; state: string } | null {
  const record = useTrainingData();
  return useMemo(() => {
    if (!record) return null;
    const em = (record as unknown as { emotion?: { trust?: number; comfort?: number; state?: string } }).emotion;
    if (em && typeof em.trust === "number" && typeof em.comfort === "number") {
      return { trust: em.trust, comfort: em.comfort, state: em.state ?? "neutral" };
    }
    return null;
  }, [record]);
}

export function useSceneSeed(): Record<string, unknown> | null {
  const record = useTrainingData();
  return useMemo(() => {
    if (!record) return null;
    const sc = (record as unknown as { scene?: Record<string, unknown> }).scene;
    if (sc && Object.keys(sc).length > 0) return sc;
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
