import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle,
  ClipboardList,
  Clock,
  Download,
  MessageCircle,
  Play,
  Settings,
  Star,
  Stethoscope,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { exportRecords, getCases, getDurationStats, getRecords, getStats } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useFeedback } from "@/components/FeedbackProvider";
import Layout from "@/components/Layout";
import { useToast } from "@/components/Toast";
import TrainingDurationChart from "@/components/TrainingDurationChart";
import Badge from "@/components/ui/Badge";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import useAuthStore from "@/stores/authStore";
import { cn } from "@/lib/utils";

type CaseBrief = components["schemas"]["CaseBrief"];
type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];
type DurationStats = components["schemas"]["DurationStats"];
type AdminStats = components["schemas"]["AdminStats"];

const QUICK_QA_HINTS = ["如何询问患者既往病史？", "糖尿病患者病史采集重点是什么？", "如何评估疼痛程度？"];

interface PatientSummary {
  gender?: string;
  age?: number;
  chief_complaint?: string;
}

interface RecordExtended {
  id: number;
  case_id: number;
  case_name: string;
  user_display_name?: string;
  start_time: string;
  end_time: string | null;
  status: string;
  score_total?: number | null;
  scoring_status?: string | null;
  scoring_error?: string | null;
  score?: ScoreData | null;
}

interface ScoreData {
  total_score?: number;
  detail_scores?: Record<
    string,
    {
      score?: number;
      max?: number;
    }
  >;
  strengths?: string[];
}

interface GradeInfo {
  label: string;
  color: "green" | "blue" | "amber" | "red";
}

export default function DashboardHome() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);

  const { data: casesData } = useQuery({
    queryKey: ["cases"],
    queryFn: () => getCases().then((r) => r.data),
    enabled: user?.role === "student",
  });
  const { data: durationData } = useQuery({
    queryKey: ["durationStats"],
    queryFn: () => getDurationStats().then((r) => r.data),
    enabled: user?.role === "student",
  });
  const { data: statsData } = useQuery({
    queryKey: ["adminStats"],
    queryFn: () => getStats().then((r) => r.data),
    enabled: user?.role === "teacher",
  });
  const { data: recordsData } = useQuery({
    queryKey: ["records", "recent"],
    queryFn: () => getRecords({ limit: 5, offset: 0 }).then((r) => r.data),
  });

  const cases = casesData?.items ?? [];
  const records = (recordsData?.items ?? []) as RecordExtended[];
  const durationStats = durationData ?? null;
  const stats = statsData ?? null;

  const handleExport = async () => {
    try {
      const { data } = await exportRecords();
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `training_records_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch {
      toast.error("导出失败");
    }
  };

  const isLoading = recordsData === undefined && casesData === undefined;

  if (isLoading) {
    return (
      <Layout>
        <PageHeader title="加载中..." subtitle="正在获取最新数据" />
        <LoadingSkeleton variant="stats" />
        <LoadingSkeleton variant="card" />
      </Layout>
    );
  }

  if (user?.role === "teacher") {
    return <TeacherDashboard stats={stats} records={records} handleExport={handleExport} navigate={navigate} />;
  }

  return <StudentDashboard cases={cases} records={records} durationStats={durationStats} navigate={navigate} />;
}

function StudentDashboard({
  cases,
  records,
  durationStats,
  navigate,
}: {
  cases: CaseBrief[];
  records: RecordExtended[];
  durationStats: DurationStats | null;
  navigate: (path: string, opts?: { state?: Record<string, unknown> }) => void;
}) {
  const location = useLocation();
  const { openFeedback, showPrompt } = useFeedback();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    const state = location.state as { feedbackPrompt?: number } | null;
    if (state?.feedbackPrompt && showPrompt) {
      openFeedback();
      window.history.replaceState({}, document.title);
    }
  }, [location.state, showPrompt, openFeedback]);

  const inProgressRecord = records.find((r) => r.status === "in_progress");
  const latestCompleted = records.find((r) => r.status === "completed" && r.score_total != null);
  const completedCount = records.filter((r) => r.status === "completed").length;
  const latestScore = latestCompleted?.score_total;

  const scoreGrade: GradeInfo | null =
    latestScore != null
      ? latestScore >= 85
        ? { label: "优秀", color: "green" }
        : latestScore >= 70
          ? { label: "良好", color: "blue" }
          : latestScore >= 60
            ? { label: "一般", color: "amber" }
            : { label: "待提高", color: "red" }
      : null;

  const recentCases = cases.slice(0, 3);

  const getPatientSummary = (ps: unknown): PatientSummary => {
    if (ps && typeof ps === "object") return ps as PatientSummary;
    return {};
  };

  return (
    <Layout>
      <PageHeader
        title={`欢迎回来，${user?.display_name || "同学"}`}
        subtitle="选择病例，开始护理病史采集训练"
        actions={
          <button
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground font-semibold text-base cursor-pointer transition-all px-6 py-3 hover:bg-primary/90"
            onClick={() => (inProgressRecord ? navigate(`/training/${inProgressRecord.id}`) : navigate("/cases"))}
          >
            {inProgressRecord ? (
              <>
                <Play size={16} />
                继续训练
              </>
            ) : (
              <>
                <Stethoscope size={16} />
                开始训练
              </>
            )}
          </button>
        }
      />

      <div className="flex mb-6 bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex-1 text-center py-3.5 px-3 border-r border-gray-100 last:border-r-0">
          <span className="block text-xl font-bold text-foreground mb-0.5">{records.length}</span>
          <span className="text-xs text-muted-foreground">训练总次数</span>
        </div>
        <div className="flex-1 text-center py-3.5 px-3 border-r border-gray-100 last:border-r-0">
          <span className="block text-xl font-bold text-foreground mb-0.5">{completedCount}</span>
          <span className="text-xs text-muted-foreground">已完成</span>
        </div>
        <div className="flex-1 text-center py-3.5 px-3 border-r border-gray-100 last:border-r-0">
          <span className="block text-xl font-bold text-foreground mb-0.5">{durationStats?.total_minutes ?? 0}</span>
          <span className="text-xs text-muted-foreground">累计分钟</span>
        </div>
        <div className="flex-1 text-center py-3.5 px-3">
          <span className={cn("block text-xl font-bold mb-0.5", latestScore != null ? "text-primary" : "text-muted-foreground")}>
            {latestScore != null ? `${latestScore}分` : "-"}
          </span>
          <span className="text-xs text-muted-foreground">
            最新得分
            {scoreGrade && (
              <Badge
                variant={scoreGrade.color === "green" ? "success" : scoreGrade.color === "red" ? "danger" : scoreGrade.color === "amber" ? "warning" : "info"}
                className="ml-1.5 text-[0.625rem]"
              >
                {scoreGrade.label}
              </Badge>
            )}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-6 items-start max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-6 min-w-0">
          <div className="bg-card border border-border rounded-xl p-12 text-center flex flex-col items-center">
            <div className="w-[88px] h-[88px] rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-6">
              <Stethoscope size={40} />
            </div>
            <div className="text-xl font-bold text-foreground mb-1.5">{inProgressRecord ? "继续进行中的训练" : "开始新的病史采集训练"}</div>
            <div className="text-sm text-muted-foreground max-w-[360px] mb-4">
              {inProgressRecord ? "你有一个进行中的训练，点击下方按钮继续。" : "选择虚拟患者，系统模拟真实护理问诊场景，训练结束后自动评分并提供反馈。"}
            </div>
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-50 text-blue-600 rounded-full text-xs font-medium mb-6">
              <BookOpen size={14} /> 病例库：{cases.length} 例可用
            </div>
            <button
              className="px-[52px] py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold cursor-pointer transition-all hover:bg-blue-700 hover:shadow-[0_4px_14px_rgba(37,99,235,0.28)]"
              onClick={() => (inProgressRecord ? navigate(`/training/${inProgressRecord.id}`) : navigate("/cases"))}
            >
              {inProgressRecord ? "继续训练 →" : "开始新的病史采集训练 →"}
            </button>
            {!inProgressRecord && <div className="text-xs text-muted-foreground mt-2.5">约 20 分钟完成一次训练</div>}
          </div>

          {recentCases.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpen size={17} />
                  推荐病例
                </h3>
                <span className="text-blue-500 cursor-pointer font-medium hover:underline" onClick={() => navigate("/cases")}>
                  查看全部 →
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {recentCases.map((c) => {
                  const p = getPatientSummary(c.patient_summary);
                  const d = c.difficulty || 1;
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2.5 p-2.5 border border-border rounded-lg cursor-pointer transition-all hover:border-gray-300 hover:bg-gray-50"
                      onClick={() => navigate("/cases")}
                    >
                      <div className="w-[34px] h-[34px] rounded-full bg-gray-100 text-gray-400 flex items-center justify-center shrink-0">
                        <Stethoscope size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-800">
                          {c.name}
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 ml-2 px-2 py-0.5 rounded-full text-xs font-semibold",
                              d === 1 && "bg-green-100 text-green-700",
                              d === 2 && "bg-amber-100 text-amber-700",
                              d === 3 && "bg-red-100 text-red-700",
                            )}
                          >
                            {"★".repeat(d)}
                            {"☆".repeat(3 - d)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.gender} · {p.age}岁 · {p.chief_complaint || "查看详情"}
                        </div>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {records.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ClipboardList size={17} />
                  最近训练记录
                </h3>
                <span className="text-blue-500 cursor-pointer font-medium hover:underline" onClick={() => navigate("/history")}>
                  查看全部 →
                </span>
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border">
                      病例
                    </th>
                    <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border">
                      时间
                    </th>
                    <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border">
                      状态
                    </th>
                    <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border">
                      得分
                    </th>
                    <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border"></th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 5).map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 border-b border-border">{r.case_name}</td>
                      <td className="px-4 py-3 border-b border-border text-sm text-muted-foreground">{new Date(r.start_time).toLocaleDateString("zh-CN")}</td>
                      <td className="px-4 py-3 border-b border-border">
                        <span
                          className={cn(
                            "inline-block px-2.5 py-0.5 rounded-xl text-xs font-semibold",
                            r.status === "completed" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-600",
                          )}
                        >
                          {r.status === "completed" ? "已完成" : "进行中"}
                        </span>
                      </td>
                      <td className={cn("px-4 py-3 border-b border-border font-semibold", r.score_total != null ? "text-primary" : "text-muted-foreground")}>
                        {r.score_total != null ? `${r.score_total}分` : "-"}
                      </td>
                      <td className="px-4 py-3 border-b border-border">
                        <span className="text-blue-500 cursor-pointer font-medium hover:underline" onClick={() => navigate(`/record/${r.id}`)}>
                          详情
                        </span>
                        {r.status === "in_progress" && (
                          <span className="text-blue-500 cursor-pointer font-medium hover:underline ml-3" onClick={() => navigate(`/training/${r.id}`)}>
                            继续训练
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border rounded-xl px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-foreground">
                <Award size={14} className="mr-1.5 inline" />
                最新反馈
              </h3>
            </div>
            {latestCompleted ? (
              <>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold text-gray-800">{latestCompleted.case_name}</span>
                  <span className="text-xs text-muted-foreground">{new Date(latestCompleted.start_time).toLocaleDateString("zh-CN")}</span>
                </div>
                <div className="flex items-baseline gap-1.5 mb-3">
                  <span className="text-3xl/[1] font-extrabold text-blue-600">{latestCompleted.score_total}</span>
                  <span className="text-xs text-muted-foreground">分</span>
                  <span
                    className={cn(
                      "text-xs font-semibold px-2 py-0.5 rounded-lg ml-1.5",
                      (latestCompleted.score_total ?? 0) >= 70 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700",
                    )}
                  >
                    {(latestCompleted.score_total ?? 0) >= 85
                      ? "优秀"
                      : (latestCompleted.score_total ?? 0) >= 70
                        ? "良好"
                        : (latestCompleted.score_total ?? 0) >= 60
                          ? "一般"
                          : "待提高"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 mb-2">
                  <div className="py-1.5 px-2.5 bg-gray-50 rounded-md text-center">
                    <span className="text-xs text-muted-foreground">沟通技能</span>
                    <span className="block text-sm font-bold text-blue-600">
                      {(latestCompleted as { score?: ScoreData }).score?.detail_scores?.沟通技能?.score ?? "-"}
                      <span className="text-xs text-muted-foreground">
                        /{(latestCompleted as { score?: ScoreData }).score?.detail_scores?.沟通技能?.max ?? "?"}
                      </span>
                    </span>
                  </div>
                  <div className="py-1.5 px-2.5 bg-gray-50 rounded-md text-center">
                    <span className="text-xs text-muted-foreground">病史采集</span>
                    <span className="block text-sm font-bold text-teal-600">
                      {(latestCompleted as { score?: ScoreData }).score?.detail_scores?.病史采集?.score ?? "-"}
                      <span className="text-xs text-muted-foreground">
                        /{(latestCompleted as { score?: ScoreData }).score?.detail_scores?.病史采集?.max ?? "?"}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="mt-1">
                  {(latestCompleted as { score?: ScoreData }).score?.strengths?.slice(0, 1).map((s: string, i: number) => (
                    <div key={i} className="text-xs text-green-500 py-0.5">
                      + {s}
                    </div>
                  ))}
                </div>
                <div className="mt-2.5">
                  <button
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground font-medium text-xs cursor-pointer transition-all px-3 py-1 hover:bg-primary/90"
                    onClick={() => navigate(`/record/${latestCompleted.id}`)}
                  >
                    查看完整报告
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-2.5 p-3.5 border border-dashed border-gray-300 rounded-lg bg-gray-50 text-gray-500">
                <Target size={18} className="text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="block text-sm text-gray-800 mb-0.5">还没有训练记录</strong>
                  <span className="block text-xs leading-relaxed">完成第一次病史采集训练后，这里将显示你的评分结果和改进建议。</span>
                  <button
                    className="mt-2.5 px-2.5 py-1 border border-blue-500 rounded-md bg-white text-blue-600 text-xs cursor-pointer hover:bg-blue-50"
                    onClick={() => navigate("/cases")}
                  >
                    去训练 →
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-foreground">
                <MessageCircle size={14} className="mr-1.5 inline" />
                快速提问
              </h3>
            </div>
            <div className="flex gap-1.5 mb-2">
              <input
                className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-gray-50 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 focus:bg-white placeholder:text-gray-300"
                placeholder="输入护理专业问题..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                    navigate(`/qa?q=${encodeURIComponent((e.target as HTMLInputElement).value.trim())}`);
                  }
                }}
              />
              <button
                className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center cursor-pointer border-none hover:bg-blue-700"
                onClick={() => {
                  const el = document.querySelector(".qa-quick-row input") as HTMLInputElement;
                  if (el?.value.trim()) navigate(`/qa?q=${encodeURIComponent(el.value.trim())}`);
                }}
              >
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {QUICK_QA_HINTS.map((h, i) => (
                <span
                  key={i}
                  className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-md cursor-pointer hover:bg-blue-100"
                  onClick={() => navigate(`/qa?q=${encodeURIComponent(h)}`)}
                >
                  {h}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-foreground">
                <TrendingUp size={14} className="mr-1.5 inline" />
                本周训练
              </h3>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 text-center py-2.5 bg-gray-50 rounded-lg">
                <div className="text-xl font-bold text-primary">{durationStats?.total_sessions ?? 0}</div>
                <div className="text-xs text-muted-foreground">训练次数</div>
              </div>
              <div className="flex-1 text-center py-2.5 bg-gray-50 rounded-lg">
                <div className="text-xl font-bold text-teal-700">{durationStats?.total_minutes ?? 0}</div>
                <div className="text-xs text-muted-foreground">累计分钟</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function TeacherDashboard({
  stats,
  records,
  handleExport,
  navigate,
}: {
  stats: AdminStats | null;
  records: RecordExtended[];
  handleExport: () => void;
  navigate: (path: string) => void;
}) {
  const recentRecords = records.slice(0, 5);
  const _user = useAuthStore((s) => s.user);

  return (
    <Layout>
      <PageHeader
        title="教学仪表盘"
        subtitle="全局概览：学生训练情况、系统数据、快捷管理入口"
        icon={Target}
        actions={
          <div className="flex gap-2">
            <button
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm cursor-pointer transition-all px-6 py-2 hover:bg-primary/90"
              onClick={() => navigate("/admin")}
            >
              <Settings size={16} /> 管理后台
            </button>
            <button
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-transparent text-gray-700 font-medium text-sm cursor-pointer transition-all px-6 py-2 hover:border-blue-500 hover:text-blue-500"
              onClick={handleExport}
            >
              <Download size={16} /> 导出CSV
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-6">
        <StatCard icon={Users} value={stats?.total_students ?? "-"} label="学生总数" color="blue" onClick={() => navigate("/admin")} />
        <StatCard icon={ClipboardList} value={stats?.total_records ?? "-"} label="总训练次数" color="teal" onClick={() => navigate("/history")} />
        <StatCard icon={CheckCircle} value={stats?.completed_records ?? "-"} label="已完成训练" color="green" />
        <StatCard icon={Star} value={stats?.average_score ?? "-"} label="平均得分" color="amber" onClick={() => navigate("/stats")} />
        <StatCard icon={Clock} value={stats?.avg_duration_min ?? "-"} label="平均时长(分钟)" color="blue" />
      </div>

      <TrainingDurationChart />

      <div className="grid grid-cols-[1fr_320px] gap-6 items-start max-[900px]:grid-cols-1 mt-6">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList size={17} />
              最近训练动态
            </h3>
            <span className="text-blue-500 cursor-pointer font-medium hover:underline" onClick={() => navigate("/history")}>
              查看全部 →
            </span>
          </div>
          {recentRecords.length > 0 ? (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border">学生</th>
                  <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border">病例</th>
                  <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border">状态</th>
                  <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border">时间</th>
                  <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border">得分</th>
                  <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-border"></th>
                </tr>
              </thead>
              <tbody>
                {recentRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 border-b border-border">{r.user_display_name}</td>
                    <td className="px-4 py-3 border-b border-border">{r.case_name}</td>
                    <td className="px-4 py-3 border-b border-border">
                      <span
                        className={cn(
                          "inline-block px-2.5 py-0.5 rounded-xl text-xs font-semibold",
                          r.status === "completed" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-600",
                        )}
                      >
                        {r.status === "completed" ? "已完成" : "进行中"}
                      </span>
                    </td>
                    <td className="px-4 py-3 border-b border-border text-sm text-muted-foreground">{new Date(r.start_time).toLocaleString("zh-CN")}</td>
                    <td className="px-4 py-3 border-b border-border">
                      {r.score_total != null ? (
                        <span
                          className={cn(
                            "font-semibold",
                            r.score_total >= 85
                              ? "text-green-600"
                              : r.score_total >= 70
                                ? "text-primary"
                                : r.score_total >= 60
                                  ? "text-amber-600"
                                  : "text-red-600",
                          )}
                        >
                          {r.score_total}分
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 border-b border-border">
                      <span className="text-blue-500 cursor-pointer font-medium hover:underline" onClick={() => navigate(`/record/${r.id}`)}>
                        详情
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center p-10 text-muted-foreground text-sm">暂无训练记录</div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-card border border-border rounded-xl px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-foreground">快捷入口</h3>
            </div>
            <div className="flex flex-col gap-2">
              <button
                className="inline-flex items-center justify-start gap-1.5 w-full rounded-lg border border-border bg-transparent text-gray-700 font-medium text-sm cursor-pointer transition-all px-6 py-2 hover:border-blue-500 hover:text-blue-500"
                onClick={() => navigate("/history")}
              >
                <ClipboardList size={14} /> 训练记录管理
              </button>
              <button
                className="inline-flex items-center justify-start gap-1.5 w-full rounded-lg border border-border bg-transparent text-gray-700 font-medium text-sm cursor-pointer transition-all px-6 py-2 hover:border-blue-500 hover:text-blue-500"
                onClick={() => navigate("/admin/users")}
              >
                <Users size={14} /> 学生账号管理
              </button>
              <button
                className="inline-flex items-center justify-start gap-1.5 w-full rounded-lg border border-border bg-transparent text-gray-700 font-medium text-sm cursor-pointer transition-all px-6 py-2 hover:border-blue-500 hover:text-blue-500"
                onClick={() => navigate("/admin/cases")}
              >
                <BookOpen size={14} /> 病例库管理
              </button>
              <button
                className="inline-flex items-center justify-start gap-1.5 w-full rounded-lg border border-border bg-transparent text-gray-700 font-medium text-sm cursor-pointer transition-all px-6 py-2 hover:border-blue-500 hover:text-blue-500"
                onClick={() => navigate("/admin/llm")}
              >
                <TrendingUp size={14} /> LLM 调用监控
              </button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-foreground">数据概况</h3>
            </div>
            <div className="text-sm leading-relaxed">
              <div className="flex justify-between">
                <span className="text-muted-foreground">学生总数</span>
                <strong>{stats?.total_students ?? "-"}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">训练完成率</span>
                <strong>{stats && stats.total_records > 0 ? `${Math.round((stats.completed_records / stats.total_records) * 100)}%` : "-"}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">今日训练次数</span>
                <strong>{stats?.today_records ?? "-"}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
