// frontend/src/plugins/questionnaire/QuestionnaireOverlay.tsx
import { useEffect, useState } from "react";
import type { SlotProps } from "@/engine/types";

interface Questionnaire {
  id: number;
  title: string;
  questions: Array<{ id: number; text: string; type: string; options?: string[] }>;
}

export function QuestionnaireOverlay({ ctx }: SlotProps) {
  const [phase, setPhase] = useState<"pre" | "post" | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    const unsubEnd = ctx.bus.on("training:ended", () => setPhase("post"));
    checkPreQuestionnaire();
    return unsubEnd;
  }, []);

  async function checkPreQuestionnaire() {
    try {
      const { api } = await import("@/api/axios-instance");
      const res = await api.get(`/questionnaires/training/${ctx.recordId}/pre`);
      if (res.data && (res.data as Questionnaire).questions?.length) {
        setQuestionnaire(res.data as Questionnaire);
        setPhase("pre");
      }
    } catch {
      /* 无前问卷 */
    }
  }

  useEffect(() => {
    if (phase === "post") {
      (async () => {
        try {
          const { api } = await import("@/api/axios-instance");
          const res = await api.get(`/questionnaires/training/${ctx.recordId}/post`);
          if (res.data && (res.data as Questionnaire).questions?.length) {
            setQuestionnaire(res.data as Questionnaire);
            setAnswers({});
          }
        } catch {
          /* 无后问卷 */
        }
      })();
    }
  }, [phase]);

  if (!phase || !questionnaire) return null;

  const submit = async () => {
    try {
      const { api } = await import("@/api/axios-instance");
      await api.post(`/questionnaires/${questionnaire.id}/submit`, {
        record_id: Number(ctx.recordId),
        answers,
      });
      setPhase(null);
      setQuestionnaire(null);
    } catch (e: any) {
      console.error("问卷提交失败", e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">{questionnaire.title}</h2>
        <div className="max-h-[60vh] space-y-4 overflow-auto">
          {questionnaire.questions.map((q) => (
            <div key={q.id}>
              <label className="mb-1 block text-sm font-medium">{q.text}</label>
              {q.type === "text" ? (
                <input
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  className="w-full rounded border px-2 py-1 text-sm"
                />
              ) : (
                <select
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  className="w-full rounded border px-2 py-1 text-sm"
                >
                  <option value="">请选择</option>
                  {q.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {phase === "pre" && (
            <button onClick={() => setPhase(null)} className="rounded px-3 py-1 text-sm text-muted-foreground">
              跳过
            </button>
          )}
          <button onClick={submit} className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground">
            提交
          </button>
        </div>
      </div>
    </div>
  );
}
