import { CheckCircle2, ChevronDown, HelpCircle, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { cn } from "@/utils/cn";

interface QuizQuestion {
  id: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  answer: string;
  explanation?: string;
}

interface QuizData {
  title?: string;
  questions?: QuizQuestion[];
}

export default function QuizTool(props: TrainingToolProps) {
  const { bus, recordId } = props;
  const rid = Number(recordId);

  const quiz: QuizData = useMemo(() => {
    const cd = props.recordDetail?.case_data as Record<string, unknown> | undefined;
    return (cd?.quiz as QuizData) ?? {};
  }, [props.recordDetail]);

  const questions = quiz.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [correctFlags, setCorrectFlags] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const answered = Object.keys(answers).length;

  useEffect(() => {
    const onResult = (payload: { tool: string; action: string; ok: boolean; data: Record<string, unknown> }) => {
      if (payload.tool !== "quiz" || payload.action !== "submit") return;
      if (!payload.ok) return;
      const qid = payload.data.question_id as string;
      const correct = !!payload.data.correct;
      setCorrectFlags((prev) => ({ ...prev, [qid]: correct }));
    };
    bus.on("tool:result", onResult);
    return () => { bus.off("tool:result", onResult); };
  }, [bus]);

  const selectOption = useCallback((questionId: string, key: string) => {
    if (answers[questionId]) return;
    setAnswers((prev) => ({ ...prev, [questionId]: key }));
    setExpanded((prev) => ({ ...prev, [questionId]: true }));
    if (rid > 0) {
      bus.emit("tool:invoke", {
        tool: "quiz",
        action: "submit",
        params: { question_id: questionId, answer: key },
        recordId: rid,
      });
    }
  }, [rid, bus, answers]);

  const toggleExplanation = (questionId: string) => {
    setExpanded((prev) => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-muted-foreground text-center">
        <HelpCircle size={24} className="opacity-40" />
        <span className="text-xs">该病例未配置引导题目</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {quiz.title ?? "引导题目"}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {answered}/{questions.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {questions.map((q, qi) => {
          const selected = answers[q.id];
          const isCorrect = correctFlags[q.id] ?? (selected === q.answer);
          const show = expanded[q.id];
          return (
            <div
              key={q.id}
              className={cn(
                "rounded-xl border p-3 transition-colors",
                selected
                  ? isCorrect
                    ? "border-emerald-500/30 bg-emerald-50/50"
                    : "border-red-500/30 bg-red-50/50"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-semibold text-muted-foreground mt-0.5 shrink-0">
                  Q{qi + 1}
                </span>
                <p className="text-sm font-medium leading-snug flex-1">{q.stem}</p>
                {selected && (
                  <span className="shrink-0">
                    {isCorrect ? (
                      <CheckCircle2 size={14} className="text-emerald-600" />
                    ) : (
                      <XCircle size={14} className="text-red-500" />
                    )}
                  </span>
                )}
              </div>

              <div className="mt-2.5 space-y-1">
                {q.options.map((opt) => {
                  const isSelected = selected === opt.key;
                  const isAnswer = opt.key === q.answer;
                  let optClass = "border-border bg-muted/30 hover:bg-muted cursor-pointer";
                  if (!selected) {
                    // not answered yet
                  } else if (isAnswer) {
                    optClass = "border-emerald-500/40 bg-emerald-50/70";
                  } else if (isSelected && !isCorrect) {
                    optClass = "border-red-500/40 bg-red-50/70";
                  } else {
                    optClass = "border-border bg-muted/30 opacity-50";
                  }

                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={!!selected}
                      onClick={() => selectOption(q.id, opt.key)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs text-left transition-colors",
                        optClass,
                      )}
                    >
                      <span className={cn(
                        "shrink-0 size-4 rounded-full border flex items-center justify-center text-[10px] font-semibold",
                        isAnswer && selected
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : isSelected && !isCorrect
                            ? "border-red-500 bg-red-500 text-white"
                            : "border-muted-foreground/30 text-muted-foreground",
                      )}>
                        {isAnswer && selected
                          ? <CheckCircle2 size={10} />
                          : isSelected && !isCorrect
                            ? <XCircle size={10} />
                            : opt.key}
                      </span>
                      <span className={cn(
                        "flex-1",
                        isAnswer && selected ? "text-emerald-700 font-medium" : "",
                        isSelected && !isCorrect ? "text-red-700 line-through" : "",
                      )}>
                        {opt.text}
                      </span>
                      {isAnswer && selected && !isCorrect && (
                        <span className="text-[10px] text-emerald-600 font-medium">正确答案</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selected && q.explanation && (
                <>
                  <button
                    onClick={() => toggleExplanation(q.id)}
                    className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown
                      size={12}
                      className={cn("transition-transform", show && "rotate-180")}
                    />
                    解析
                  </button>
                  {show && (
                    <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed bg-muted/30 rounded-lg px-3 py-2">
                      {q.explanation}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {answered === questions.length && questions.length > 0 && (
        <div className="px-3 py-2 border-t border-border bg-emerald-50/50 shrink-0">
          <p className="text-xs text-emerald-700 text-center">
            <CheckCircle2 size={12} className="inline mr-1" />
            全部完成 — 共 {answered} 题
          </p>
        </div>
      )}
    </div>
  );
}
