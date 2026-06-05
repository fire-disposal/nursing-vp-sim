import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Lightbulb, MessageSquare, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ScoreItemData {
  id?: number;
  name: string;
  score: number;
  evidence?: string;
  reason?: string;
}

interface DetailScoreCategory {
  score: number;
  max: number;
  items?: ScoreItemData[];
}

interface ScoreData {
  total_score: number;
  detail_scores?: Record<string, DetailScoreCategory>;
  strengths?: string[];
  weaknesses?: string[];
  missed_content?: string[];
  suggestions?: string;
  rubric_version?: string;
}

function ScoreBar({ label, score, max, variant }: { label: string; score: number; max: number; variant: "blue" | "teal" }) {
  const pct = Math.min((score / (max || 1)) * 100, 100);

  return (
    <div className="mb-4">
      <div className="flex justify-between mb-1.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className={cn("text-sm font-bold", variant === "blue" ? "text-blue-600" : "text-teal-500")}>
          {score}
          <span className="text-xs text-gray-400 font-normal"> / {max}</span>
        </span>
      </div>
      <div className={cn("h-[7px] rounded overflow-hidden", variant === "blue" ? "bg-blue-50" : "bg-teal-50")}>
        <div
          className={cn("h-full rounded transition-[width] duration-600", variant === "blue" ? "bg-blue-600" : "bg-teal-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ScoreItem({ item }: { item: ScoreItemData }) {
  const [expanded, setExpanded] = useState(item.score < 2);
  const hasEvidence = item.evidence || item.reason;

  return (
    <div className="mb-1">
      <div
        onClick={() => hasEvidence && setExpanded(!expanded)}
        className={cn(
          "flex justify-between items-center px-2.5 py-1.5 rounded-md transition-colors duration-150",
          hasEvidence ? "cursor-pointer" : "cursor-default",
          item.score >= 3 ? "bg-green-50" : item.score >= 2 ? "bg-amber-50" : "bg-red-50",
        )}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {hasEvidence && <span className="text-gray-400 shrink-0">{expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</span>}
          <span className="text-xs text-gray-700 overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
        </div>
        <span className={cn("text-xs font-bold ml-2 shrink-0", item.score >= 3 ? "text-green-700" : item.score >= 2 ? "text-amber-700" : "text-red-600")}>
          {item.score}/3
        </span>
      </div>
      <div
        className={cn(
          "overflow-hidden transition-all duration-300",
          expanded && hasEvidence ? "max-h-[200px] opacity-100 m-[2px_4px_4px_24px]" : "max-h-0 opacity-0 m-[0_4px_0_24px]",
        )}
      >
        <div className="p-2 rounded-md bg-slate-50 border border-border text-xs leading-[1.55]">
          {item.evidence && (
            <div className={item.reason ? "mb-1" : ""}>
              <span className="font-semibold text-gray-500 flex items-center gap-1">
                <MessageSquare size={10} /> 证据
              </span>
              <span className="text-gray-700">{item.evidence}</span>
            </div>
          )}
          {item.reason && (
            <div>
              <span className="font-semibold text-gray-500">理由：</span>
              <span className="text-gray-700">{item.reason}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ScoreCardProps {
  score: ScoreData;
  onClose: () => void;
  onRetry?: () => void;
  onGoHome?: () => void;
}

export default function ScoreCard({ score, onClose, onRetry, onGoHome }: ScoreCardProps) {
  if (!score) return null;

  const detailScores = score.detail_scores || {};
  const categories = Object.entries(detailScores);
  const hasItems = categories.some(([, v]) => v && typeof v === "object" && Array.isArray(v.items) && v.items.length > 0);

  const maxTotal = categories.reduce((sum, [, v]) => sum + (v && typeof v === "object" ? v.max || 0 : 0), 0) || 100;

  const rubricLabel = score.rubric_version ? `评分标准: ${score.rubric_version}` : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[200] backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="bg-card rounded-2xl p-8 max-w-[600px] w-[92vw] max-h-[85vh] overflow-y-auto shadow-[0_20px_50px_rgba(0,0,0,0.15)] animate-[scoreSlideUp_0.25s_ease]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold">训练评分报告</h2>
            {rubricLabel && <span className="text-xs text-muted-foreground/60">{rubricLabel}</span>}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-border bg-card cursor-pointer flex items-center justify-center"
            aria-label="关闭评分"
          >
            <X size={16} />
          </button>
        </div>

        <div className="text-center mb-5">
          <div className="text-[3.5rem] font-extrabold text-primary">{score.total_score}</div>
          <div className="text-muted-foreground text-sm">总分 (满分{maxTotal})</div>
        </div>

        {categories.map(([catName, catData]) => {
          if (!catData || typeof catData !== "object") return null;
          return (
            <ScoreBar key={catName} label={catName} score={catData.score || 0} max={catData.max || 30} variant={catName.includes("沟通") ? "blue" : "teal"} />
          );
        })}

        {hasItems &&
          categories.map(([catName, catData]) => {
            if (!catData || !Array.isArray(catData.items)) return null;
            return (
              <div key={catName} className="mb-4">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{catName} · 逐项评分（点击展开证据）</div>
                <div className="flex flex-col">
                  {catData.items.map((item, i) => (
                    <ScoreItem key={item.id || i} item={item} />
                  ))}
                </div>
              </div>
            );
          })}

        <div className="mb-4">
          <h4 className="flex items-center gap-1.5 text-sm mb-1.5">
            <CheckCircle size={16} color="#22c55e" />
            表现较好
          </h4>
          {score.strengths && score.strengths.length > 0 ? (
            <ul className="pl-6">
              {score.strengths.map((s, i) => (
                <li key={i} className="text-sm text-gray-600 mb-0.5">
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground/50 italic pl-6">AI 未生成此部分内容，可重新评分获取完整报告</p>
          )}
        </div>

        <div className="mb-4">
          <h4 className="flex items-center gap-1.5 text-sm mb-1.5">
            <AlertTriangle size={16} color="#f59e0b" />
            需要改善
          </h4>
          {score.weaknesses && score.weaknesses.length > 0 ? (
            <ul className="pl-6">
              {score.weaknesses.map((w, i) => (
                <li key={i} className="text-sm text-gray-600 mb-0.5">
                  {w}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground/50 italic pl-6">AI 未生成此部分内容，可重新评分获取完整报告</p>
          )}
        </div>

        <div className="mb-4">
          <h4 className="flex items-center gap-1.5 text-sm mb-1.5">
            <AlertTriangle size={16} color="#ef4444" />
            漏问内容
          </h4>
          {score.missed_content && score.missed_content.length > 0 ? (
            <ul className="pl-6">
              {score.missed_content.map((m, i) => (
                <li key={i} className="text-sm text-gray-600 mb-0.5">
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground/50 italic pl-6">AI 未生成此部分内容，可重新评分获取完整报告</p>
          )}
        </div>

        <div className="mb-4">
          <h4 className="flex items-center gap-1.5 text-sm mb-1.5">
            <Lightbulb size={16} color="#2563eb" />
            改进建议
          </h4>
          {score.suggestions ? (
            <div className="text-sm text-gray-600 pl-6">{score.suggestions}</div>
          ) : (
            <p className="text-sm text-muted-foreground/50 italic pl-6">AI 未生成改进建议，可重新评分获取完整报告</p>
          )}
        </div>

        {(onRetry || onGoHome) && (
          <div className="flex gap-3 mt-7 justify-center">
            {onRetry && (
              <button
                onClick={onRetry}
                className="inline-flex items-center justify-center gap-1.5 py-[9px] px-[22px] border-none rounded-lg text-sm font-medium cursor-pointer transition-all duration-150 bg-primary text-primary-foreground hover:bg-blue-700"
              >
                再试一次
              </button>
            )}
            {onGoHome && (
              <button
                onClick={onGoHome}
                className="inline-flex items-center justify-center gap-1.5 py-[9px] px-[22px] border border-border rounded-lg text-sm font-medium cursor-pointer transition-all duration-150 bg-card text-foreground hover:bg-muted"
              >
                结束训练（返回首页）
              </button>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes scoreSlideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
