import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Download,
  Edit3,
  FileText,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
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
import PageHeader from "@/components/ui/PageHeader";
import useAuthStore from "@/stores/authStore";
import { cn } from "@/lib/utils";

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
    <div className="mb-1.5">
      <div className="flex justify-between items-center px-3 py-2 rounded-lg bg-gray-50 border border-border flex-wrap gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-gray-700">{item.name}</span>
            {hasEvidence && (
              <button onClick={() => setExpanded(!expanded)} className="border-0 bg-transparent cursor-pointer p-0 text-gray-400 flex">
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-gray-400">AI 评分: </span>
            <span className={cn("text-xs font-bold", item.score >= 3 ? "text-green-700" : item.score >= 2 ? "text-amber-700" : "text-red-600")}>
              {item.score}/3
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              onClick={() => onChange(item.id, s)}
              className={cn(
                "w-8 h-8 rounded-lg text-sm cursor-pointer transition-all",
                currentScore === s ? "border-2 border-primary bg-blue-50 text-primary font-bold" : "border border-gray-300 bg-white text-gray-500 font-medium",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {expanded && hasEvidence && (
        <div className="ml-3 mr-1 my-1 px-2.5 py-2 rounded-md bg-gray-50 border border-border text-xs leading-relaxed">
          {item.evidence && (
            <div className={cn(item.reason && "mb-1")}>
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[200] backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl p-8 max-w-[640px] w-[92vw] max-h-[90vh] overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold">教师复核评分</h2>
            <span className="text-xs text-muted-foreground">逐项审核 AI 评分，可修改每项分值</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg border border-border bg-white cursor-pointer flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        {isNewFormat ? (
          categories.map(([catName, catData]) => (
            <div key={catName} className="mb-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {catName}（{catData.score}/{catData.max}）
              </div>
              {(catData.items || []).map((item) => (
                <ReviewItem key={item.id} item={item} editedScore={editedScores[item.id]} onChange={handleScoreChange} />
              ))}
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-500 py-4 text-center">此评分为旧版格式，不支持逐项修改。如需复核，请重新触发评分。</div>
        )}

        <div className="mt-4">
          <label className="text-sm font-semibold text-gray-700 block mb-1.5">复核备注</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="可选：对评分调整的说明..."
            rows={3}
            className="w-full px-3 py-2.5 rounded-lg border border-input text-sm resize-y font-[inherit]"
          />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            className="inline-flex items-center gap-1.5 px-[22px] py-2 rounded-lg border border-border bg-transparent text-gray-700 text-sm font-medium cursor-pointer transition hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            className="inline-flex items-center gap-1.5 px-[22px] py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium cursor-pointer transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="text-center py-16 text-muted-foreground">加载中...</div>
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

  return (
    <Layout>
      <PageHeader title="记录详情" subtitle={`训练记录 #${record.id}`} icon={FileText} backTo="/history" />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
            <User size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold leading-tight">{(record as { user_display_name?: string }).user_display_name}</div>
            <div className="text-xs text-muted-foreground">学生</div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-cyan-50 text-cyan-500 flex items-center justify-center shrink-0">
            <ClipboardList size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold leading-tight">{record.case_name}</div>
            <div className="text-xs text-muted-foreground">病例</div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
            <Clock size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-tight">{duration != null ? `${duration}分钟` : "-"}</div>
            <div className="text-xs text-muted-foreground">训练时长</div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-green-50 text-green-500 flex items-center justify-center shrink-0">
            <BarChart3 size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-tight">{recordScore?.total_score ?? "-"}</div>
            <div className="text-xs text-muted-foreground">得分</div>
          </div>
        </div>
      </div>

      {record.status === "completed" && !record.score && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-amber-700 font-semibold">
                {record.scoring_status === "pending" || record.scoring_status === "processing" ? "评分正在生成中..." : "暂无评分"}
              </h3>
              <p className="text-sm text-amber-700 mt-1">
                {record.scoring_status === "pending" || record.scoring_status === "processing"
                  ? "AI 正在分析对话内容，预计几秒到一分钟内完成。"
                  : record.scoring_status === "failed"
                    ? `评分失败: ${record.scoring_error || "未知错误"}`
                    : "评分尚未生成"}
              </p>
            </div>
            {record.scoring_status === "failed" && (
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium cursor-pointer transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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

      {record.score && (
        <div className="rounded-xl p-6 mb-6 bg-gradient-to-br from-indigo-50 to-sky-50">
          <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="m-0">评分结果</h3>
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
            <div className="flex gap-2">
              {isTeacher && (
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-transparent text-gray-700 text-xs font-medium cursor-pointer transition hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setShowReviewEditor(true)}
                >
                  <Edit3 size={14} /> {isReviewed ? "修改复核" : "复核评分"}
                </button>
              )}
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium cursor-pointer transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setShowScore(true)}
              >
                查看详细评分
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-transparent text-gray-700 text-xs font-medium cursor-pointer transition hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleExport}
              >
                <Download size={14} />
                导出记录
              </button>
            </div>
          </div>
          <div className="text-[2.5rem] font-extrabold text-primary">
            {(record.score as ScoreData).total_score}
            <span className="text-base text-muted-foreground font-normal"> / {scoreMax}分</span>
          </div>
          {isReviewed && review?.review_comment && (
            <div className="mt-2.5 px-3 py-2 rounded-md bg-white/70 text-sm text-gray-700 border border-border">
              <span className="font-semibold text-gray-500">复核备注：</span>
              {review.review_comment}
            </div>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <MessageCircle size={18} />
            对话回放 ({messages.length}条消息)
          </h3>
        </div>
        <div className="bg-gray-50 rounded-lg p-6 max-h-[400px] overflow-y-auto">
          {messages.map((msg) => (
            <div key={msg.id} className="mb-2.5 text-sm leading-relaxed">
              <span className={cn("font-semibold mr-2", msg.role === "student" ? "text-primary" : "text-teal-600")}>
                {msg.role === "student" ? "学生：" : "患者："}
              </span>
              <span>{msg.content}</span>
            </div>
          ))}
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
