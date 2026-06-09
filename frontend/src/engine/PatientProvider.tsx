// frontend/src/engine/PatientProvider.tsx
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { api } from "@/api/axios-instance";
import type { PatientData } from "./types";

interface PatientContextValue {
  patient: PatientData | null;
  loading: boolean;
  error: string | null;
}

const PatientContext = createContext<PatientContextValue>({
  patient: null,
  loading: true,
  error: null,
});

export function PatientProvider({ recordId, children }: { recordId: string; children: ReactNode }) {
  const [patient, setPatient] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/training/records/${recordId}`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        setPatient({
          name: d.patient_name ?? d.patient?.name ?? "患者",
          age: d.patient_age ?? d.patient?.age ?? 0,
          gender: d.patient_gender ?? d.patient?.gender ?? "male",
          caseTitle: d.case_title ?? d.case?.title ?? "",
          chiefComplaint: d.chief_complaint ?? d.case?.chief_complaint ?? "",
          personality: d.personality ?? d.case?.personality ?? "",
          requiredInquiries: d.required_inquiries ?? [],
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "加载患者信息失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  return <PatientContext.Provider value={{ patient, loading, error }}>{children}</PatientContext.Provider>;
}

export function usePatient() {
  return useContext(PatientContext);
}
