// frontend/src/plugins/scoring-display/ScoreCard.tsx
import { useEffect, useState } from "react";
import type { ScoreData, SlotProps } from "@/engine/types";

interface ScoreCardInnerProps extends SlotProps {
  score: ScoreData;
  onClose: () => void;
}

export function ScoreCardInner({ score, onClose }: ScoreCardInnerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md max-h-[80vh] overflow-auto rounded-lg bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">训练评分报告</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        {score.total_score !== undefined && (
          <div className="mb-4 text-center">
            <span className="text-4xl font-bold text-primary">{score.total_score}</span>
            <span className="text-muted-foreground"> 分</span>
          </div>
        )}

        {score.detail_scores && (
          <div className="mb-4 space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">详细评分</h3>
            {Object.entries(score.detail_scores).map(([key, val]) => (
              <div key={key} className="flex justify-between text-sm">
                <span>{key}</span>
                <span className="tabular-nums">{val}</span>
              </div>
            ))}
          </div>
        )}

        {score.strengths?.length ? (
          <div className="mb-3">
            <h3 className="text-sm font-medium text-green-600">优势</h3>
            <ul className="list-inside list-disc text-sm">
              {score.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {score.weaknesses?.length ? (
          <div className="mb-3">
            <h3 className="text-sm font-medium text-red-600">改进建议</h3>
            <ul className="list-inside list-disc text-sm">
              {score.weaknesses.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {score.summary && (
          <div className="mb-4 rounded bg-muted p-3 text-sm">
            <h3 className="mb-1 font-medium">总结</h3>
            <p>{score.summary}</p>
          </div>
        )}

        <button type="button" onClick={onClose} className="w-full rounded bg-primary py-2 text-sm text-primary-foreground">
          返回
        </button>
      </div>
    </div>
  );
}

export function ScoreCard({ ctx }: SlotProps) {
  const [score, setScore] = useState<ScoreData | null>(null);

  useEffect(() => {
    const unsub = ctx.bus.on("score:ready", (data: ScoreData) => {
      setScore(data);
    });
    return unsub;
  }, [ctx.bus]);

  if (!score) return null;

  return <ScoreCardInner ctx={ctx} score={score} onClose={() => setScore(null)} />;
}
