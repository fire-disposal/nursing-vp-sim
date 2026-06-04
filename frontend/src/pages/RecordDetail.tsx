import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Download,
  Edit3,
  FileText,
  Lightbulb,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  User,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { exportRecordDetail, getRecordDetail, getScoreReview, retryScoring, submitScoreReview } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Layout from "@/components/Layout";
import ScoreCard from "@/components/ScoreCard";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/authStore";

type TrainingRecordDetail = components["schemas"]["TrainingRecordDetail"];
type ScoreReviewResponse = components["schemas"]["ScoreReviewResponse"];

interface ScoreItemData {
  id: number;
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

interface MessageData {
  id: number;
  role: string;
  content: string;
}

interface ReviewItemProps {
  item: ScoreItemData;
  editedScore?: number;
  onChange: (itemId: number, newScore: number) => void;
}

function ReviewItem({ item, editedScore, onChange }: ReviewItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasEvidence = item.evidence || item.reason;
  const currentScore = editedScore !== undefined ? editedScore : item.score;

  return (
    <div className="mb-2">
      <div className="flex justify-between items-center px-3 py-2.5 rounded-lg bg-muted/50 border border-border flex-wrap gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{item.name}</span>
            {hasEvidence && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="border-0 bg-transparent p-0 text-muted-foreground flex hover:text-foreground transition-colors"
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-muted-foreground">AI 评分: </span>
            <span className={cn("text-xs font-bold", item.score >= 3 ? "text-green-600" : item.score >= 2 ? "text-amber-600" : "text-red-600")}>
              {item.score}/3
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              onClick={() => onChange(item.id, s)}
              className={cn(
                "w-8 h-8 rounded-lg text-sm font-medium transition-all",
                currentScore === s
                  ? "border-2 border-primary bg-primary/10 text-primary"
                  : "border border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {expanded && hasEvidence && (
        <div className="ml-3 mt-2 px-3 py-2.5 rounded-lg bg-muted/30 border border-border text-xs leading-relaxed">
          {item.evidence && (
            <div className={cn(item.reason && "mb-2")}>
              <span className="font-semibold text-muted-foreground flex items-center gap-1 mb-0.5">
                <MessageSquare size={11} /> 证据
              </span>
              <span className="text-foreground/80">{item.evidence}</span>
            </div>
          )}
          {item.reason && (
            <div>
              <span className="font-semibold text-muted-foreground">理由：</span>
              <span className="text-foreground/80">{item.reason}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ReviewEditorProps {
  score: ScoreData;
  review: ScoreReviewResponse | null;
  onSubmit: (modifiedScores: Record<string, DetailScoreCategory>, comment: string) => void;
  onClose: () => void;
  submitting: boolean;
}

function ReviewEditor({ score, review, onSubmit, onClose, submitting }: ReviewEditorProps) {
  const detailScores = score?.detail_scores || {};
  const [comment, setComment] = useState(review?.review_comment || "");
  const [editedScores, setEditedScores] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    for (const [, catData] of Object.entries(detailScores)) {
      if (catData && typeof catData === "object" && "items" in catData) {
        for (const item of catData.items || []) {
          initial[item.id] = item.score;
        }
      }
    }
    return initial;
  });

  const categories = Object.entries(detailScores);
  const isNewFormat = categories.length > 0 && categories[0][1] && typeof categories[0][1] === "object" && "items" in categories[0][1];

  const handleScoreChange = (itemId: number, newScore: number) => {
    setEditedScores((prev) => ({ ...prev, [itemId]: newScore }));
  };

  const handleSubmit = () => {
    const modified = JSON.parse(JSON.stringify(detailScores)) as Record<string, DetailScoreCategory>;
    for (const [, catData] of Object.entries(modified)) {
      if (catData && typeof catData === "object" && "items" in catData) {
        let catTotal = 0;
        for (const item of catData.items || []) {
          if (editedScores[item.id] !== undefined) {
            item.score = editedScores[item.id];
          }
          catTotal += item.score;
        }
        catData.score = catTotal;
      }
    }
    onSubmit(modified, comment);
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[200]" onClick={onClose}>
      <div
        className="bg-card rounded-2xl p-6 sm:p-8 max-w-[640px] w-[94vw] max-h-[90vh] overflow-auto shadow-xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-5">
          <div>
            <h2 className="text-lg font-semibold">教师复核评分</h2>
            <span className="text-xs text-muted-foreground">逐项审核 AI 评分，可修改每项分值</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {isNewFormat ? (
          categories.map(([catName, catData]) => (
            <div key={catName} className="mb-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                <span>{catName}</span>
                <Badge variant="neutral">
                  {catData.score}/{catData.max}
                </Badge>
              </div>
              {(catData.items || []).map((item) => (
                <ReviewItem key={item.id} item={item} editedScore={editedScores[item.id]} onChange={handleScoreChange} />
              ))}
            </div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border rounded-xl">
            此评分为旧版格式，不支持逐项修改。如需复核，请重新触发评分。
          </div>
        )}

        <div className="mt-4">
          <label className="text-sm font-semibold block mb-1.5">复核备注</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="可选：对评分调整的说明..."
            rows={3}
            className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm resize-y placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary"
          />
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "提交中..." : "提交复核"}
          </button>
        </div>
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
          "flex justify-between items-center px-3 py-2 rounded-lg transition-colors",
          hasEvidence ? "cursor-pointer hover:bg-muted/80" : "cursor-default",
          item.score >= 3 ? "bg-green-50 dark:bg-green-950/20" : item.score >= 2 ? "bg-amber-50 dark:bg-amber-950/20" : "bg-red-50 dark:bg-red-950/20",
        )}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {hasEvidence && <span className="text-muted-foreground shrink-0">{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>}
          <span className="text-sm truncate">{item.name}</span>
        </div>
        <span className={cn("text-sm font-bold ml-2 shrink-0", item.score >= 3 ? "text-green-600" : item.score >= 2 ? "text-amber-600" : "text-red-600")}>
          {item.score}/3
        </span>
      </div>
      <div className={cn("overflow-hidden transition-all duration-300", expanded && hasEvidence ? "max-h-[300px] opacity-100 mt-1 ml-4" : "max-h-0 opacity-0")}>
        <div className="p-3 rounded-lg bg-muted/30 border border-border text-sm leading-relaxed">
          {item.evidence && (
            <div className={item.reason ? "mb-2" : ""}>
              <span className="font-semibold text-muted-foreground flex items-center gap-1 mb-0.5">
                <MessageSquare size={11} /> 证据
              </span>
              <span className="text-foreground/80">{item.evidence}</span>
            </div>
          )}
          {item.reason && (
            <div>
              <span className="font-semibold text-muted-foreground">理由：</span>
              <span className="text-foreground/80">{item.reason}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RecordDetail() {
  const { id } = useParams<{ id: string }>();
  const [showScore, setShowScore] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showReviewEditor, setShowReviewEditor] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const { confirm } = useConfirm();

  const { data: record, isError: recordError } = useQuery({
    queryKey: ["recordDetail", id],
    queryFn: () => getRecordDetail(id!).then((r) => r.data),
    enabled: !!id,
  });

  const { data: review } = useQuery({
    queryKey: ["scoreReview", id],
    queryFn: () => getScoreReview(id!).then((r) => r.data),
    enabled: !!id && !!record?.score,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (recordError) {
      toast.error("加载记录详情失败");
      navigate("/history");
    }
  }, [recordError, navigate, toast]);

  const isReviewed = review?.review_status === "reviewed";
  const isTeacher = user?.role === "teacher";

  const handleRetryScoring = async () => {
    setRetrying(true);
    try {
      await retryScoring(id!);
      toast.info("评分已重新触发，请稍后刷新查看结果");
      for (let i = 0; i < 30; i++) {
        await new Promise<void>((r) => setTimeout(r, 3000));
        const { data } = await getRecordDetail(id!);
        if (data.scoring_status === "completed" && data.score) {
          queryClient.setQueryData(["recordDetail", id], data);
          toast.success("评分已完成");
          break;
        }
        if (data.scoring_status === "failed") {
          queryClient.setQueryData(["recordDetail", id], data);
          toast.error("评分再次失败: " + (data.scoring_error || "未知错误"));
          break;
        }
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      toast.error(axiosErr.response?.data?.detail || "重试评分失败");
    } finally {
      setRetrying(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await exportRecordDetail(id!);
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `record_${id}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("导出失败");
    }
  };

  const handleSubmitReview = async (modifiedScores: Record<string, DetailScoreCategory>, comment: string) => {
    setSubmittingReview(true);
    try {
      await submitScoreReview(id!, {
        detail_scores: modifiedScores,
        comment,
      });
      toast.success("复核已提交");
      setShowReviewEditor(false);
      queryClient.invalidateQueries({ queryKey: ["recordDetail", id] });
      queryClient.invalidateQueries({ queryKey: ["scoreReview", id] });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      toast.error(axiosErr.response?.data?.detail || "提交复核失败");
    } finally {
      setSubmittingReview(false);
    }
  };

  if (!record) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
            <span className="text-sm">加载中...</span>
          </div>
        </div>
      </Layout>
    );
  }

  const duration = record.end_time ? Math.round((new Date(record.end_time).getTime() - new Date(record.start_time).getTime()) / 60000) : null;
  const scoreMax = record.score?.detail_scores
    ? Object.values(record.score.detail_scores).reduce((sum: number, value) => {
        if (value && typeof value === "object" && "max" in (value as DetailScoreCategory)) return sum + ((value as DetailScoreCategory).max || 0);
        return sum + 30;
      }, 0)
    : 100;

  const recordScore = record.score as ScoreData | null;
  const messages = (record.messages || []) as MessageData[];
  const hasScore = !!record.score;
  const detailScores = recordScore?.detail_scores || {};
  const categories = Object.entries(detailScores);
  const hasDetailItems = categories.some(([, v]) => v && typeof v === "object" && Array.isArray(v.items) && v.items.length > 0);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="flex items-center gap-2 text-sm">
          <button
            onClick={() => navigate("/history")}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            <span>训练记录</span>
          </button>
          <ChevronRight size={14} className="text-muted-foreground/50" />
          <span className="font-medium text-foreground">#{record.id}</span>
        </nav>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <User size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold truncate">{(record as { user_display_name?: string }).user_display_name || "-"}</div>
              <div className="text-xs text-muted-foreground">学生</div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
              <FileText size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold truncate">{record.case_name || "-"}</div>
              <div className="text-xs text-muted-foreground">病例</div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <Clock size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold">{duration != null ? `${duration}分钟` : "-"}</div>
              <div className="text-xs text-muted-foreground">训练时长</div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400">
              <BarChart3 size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold">{recordScore?.total_score ?? "-"}</div>
              <div className="text-xs text-muted-foreground">{hasScore ? `得分 / ${scoreMax}` : "得分"}</div>
            </div>
          </div>
        </div>

        {record.status === "completed" && !record.score && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h3 className="font-semibold text-amber-700 dark:text-amber-400">
                  {record.scoring_status === "pending" || record.scoring_status === "processing" ? "评分正在生成中..." : "暂无评分"}
                </h3>
                <p className="text-sm text-amber-700/80 dark:text-amber-400/80 mt-1">
                  {record.scoring_status === "pending" || record.scoring_status === "processing"
                    ? "AI 正在分析对话内容，预计几秒到一分钟内完成。"
                    : record.scoring_status === "failed"
                      ? `评分失败: ${record.scoring_error || "未知错误"}`
                      : "评分尚未生成"}
                </p>
              </div>
              {record.scoring_status === "failed" && (
                <button
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  onClick={handleRetryScoring}
                  disabled={retrying}
                >
                  <RefreshCw size={14} className={cn(retrying && "animate-spin")} />
                  <span>{retrying ? "重试中..." : "重新评分"}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {hasScore && recordScore && (
          <div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-base font-semibold">评分结果</h3>
                {isReviewed ? (
                  <Badge variant="success">
                    <ShieldCheck size={12} /> 教师已复核
                  </Badge>
                ) : (
                  <Badge variant="info">AI 初评</Badge>
                )}
                {isReviewed && review?.reviewed_by_name && (
                  <span className="text-xs text-muted-foreground">
                    复核人: {review.reviewed_by_name}
                    {review.reviewed_at && ` · ${new Date(review.reviewed_at).toLocaleDateString("zh-CN")}`}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {isTeacher && (
                  <button
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted hover:border-primary/50 transition-colors"
                    onClick={() => setShowReviewEditor(true)}
                  >
                    <Edit3 size={14} /> {isReviewed ? "修改复核" : "复核评分"}
                  </button>
                )}
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  onClick={() => setShowScore(true)}
                >
                  查看详细评分
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted hover:border-primary/50 transition-colors"
                  onClick={handleExport}
                >
                  <Download size={14} />
                  导出记录
                </button>
              </div>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-primary">{recordScore.total_score}</span>
              <span className="text-base text-muted-foreground">/ {scoreMax} 分</span>
            </div>

            {isReviewed && review?.review_comment && (
              <div className="px-4 py-3 rounded-lg bg-muted/50 border border-border text-sm">
                <span className="font-semibold text-muted-foreground">复核备注：</span>
                <span>{review.review_comment}</span>
              </div>
            )}

            {hasDetailItems && (
              <div className="space-y-4 pt-2 border-t border-border">
                {categories.map(([catName, catData]) => {
                  if (!catData || !Array.isArray(catData.items) || catData.items.length === 0) return null;
                  const pct = catData.max > 0 ? Math.round((catData.score / catData.max) * 100) : 0;
                  return (
                    <div key={catName} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{catName}</span>
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {catData.score}/{catData.max}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-700",
                            pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="space-y-0.5 mt-2">
                        {catData.items.map((item, i) => (
                          <ScoreItem key={item.id || i} item={item} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {recordScore.strengths && recordScore.strengths.length > 0 && (
              <div className="pt-2 border-t border-border">
                <h4 className="flex items-center gap-2 text-sm font-semibold mb-3">
                  <ThumbsUp size={16} className="text-green-500" />
                  表现较好
                </h4>
                <ul className="space-y-1.5">
                  {recordScore.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle size={14} className="text-green-500 shrink-0 mt-0.5" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {recordScore.weaknesses && recordScore.weaknesses.length > 0 && (
              <div className="pt-2 border-t border-border">
                <h4 className="flex items-center gap-2 text-sm font-semibold mb-3">
                  <ThumbsDown size={16} className="text-amber-500" />
                  需要改善
                </h4>
                <ul className="space-y-1.5">
                  {recordScore.weaknesses.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="size-3.5 rounded-full border-2 border-amber-400 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {recordScore.suggestions && (
              <div className="pt-2 border-t border-border">
                <h4 className="flex items-center gap-2 text-sm font-semibold mb-3">
                  <Lightbulb size={16} className="text-blue-500" />
                  改进建议
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{recordScore.suggestions}</p>
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
            <MessageCircle size={18} />
            对话回放 ({messages.length}条消息)
          </h3>
          <div className="rounded-lg bg-muted/50 p-4 sm:p-6 max-h-[400px] overflow-y-auto space-y-2">
            {messages.map((msg) => (
              <div key={msg.id} className="text-sm leading-relaxed">
                <span className={cn("font-semibold mr-2", msg.role === "student" ? "text-primary" : "text-teal-600 dark:text-teal-400")}>
                  {msg.role === "student" ? "学生：" : "患者："}
                </span>
                <span className="text-foreground/80">{msg.content}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showScore && record.score && <ScoreCard score={record.score as ScoreData} onClose={() => setShowScore(false)} />}

      {showReviewEditor && record.score && (
        <ReviewEditor
          score={record.score as ScoreData}
          review={review ?? null}
          onSubmit={handleSubmitReview}
          onClose={() => setShowReviewEditor(false)}
          submitting={submittingReview}
        />
      )}
    </Layout>
  );
}
