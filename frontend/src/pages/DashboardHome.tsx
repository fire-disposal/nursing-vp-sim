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
import { useToast } from "@/components/Toast";
import TrainingDurationChart from "@/components/TrainingDurationChart";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/EmptyState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/authStore";
import type { ScoreData } from "@/types/score";

type CaseBrief = components["schemas"]["CaseBrief"];
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

interface GradeInfo {
  label: string;
  color: "green" | "blue" | "amber" | "red";
}

export default function DashboardHome() {
  const navigate = useNavigate();
  const toast = useToast();

  const perms = (() => {
    try {
      return JSON.parse(localStorage.getItem("user_permissions") || "[]") as string[];
    } catch {
      return [];
    }
  })();
  const isAdmin = perms.includes("score_review") || perms.includes("user_manage");

  const { data: casesData } = useQuery({
    queryKey: ["cases"],
    queryFn: () => getCases().then((r) => r.data),
    enabled: !isAdmin,
  });
  const { data: durationData } = useQuery({
    queryKey: ["durationStats"],
    queryFn: () => getDurationStats().then((r) => r.data),
    enabled: !isAdmin,
  });
  const { data: statsData } = useQuery({
    queryKey: ["adminStats"],
    queryFn: () => getStats().then((r) => r.data),
    enabled: isAdmin,
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
        <div className="space-y-6">
          <LoadingSkeleton variant="stats" />
          <LoadingSkeleton variant="card" />
        </div>
      </Layout>
    );
  }

  if (isAdmin) {
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

  const scoreColor = scoreGrade?.color === "green" ? "green" : scoreGrade?.color === "red" ? "red" : scoreGrade?.color === "amber" ? "amber" : "blue";

  return (
    <Layout>
      <PageHeader
        title={`欢迎回来，${user?.display_name || "同学"}`}
        subtitle="选择病例，开始护理病史采集训练"
        actions={
          <Button size="lg" onClick={() => (inProgressRecord ? navigate(`/training/${inProgressRecord.id}`) : navigate("/cases"))}>
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
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        <StatCard icon={ClipboardList} value={records.length} label="训练总次数" color="blue" />
        <StatCard icon={CheckCircle} value={completedCount} label="已完成" color="green" />
        <StatCard icon={Clock} value={durationStats?.total_minutes ?? 0} label="累计分钟" color="amber" />
        <StatCard
          icon={Target}
          value={
            <>
              {latestScore != null ? `${latestScore}分` : "-"}
              {scoreGrade && (
                <Badge
                  variant={scoreGrade.color === "green" ? "success" : scoreGrade.color === "red" ? "danger" : scoreGrade.color === "amber" ? "warning" : "info"}
                  className="ml-1.5 text-[0.625rem]"
                >
                  {scoreGrade.label}
                </Badge>
              )}
            </>
          }
          label="最新得分"
          color={scoreColor}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <Card size="sm">
            <CardContent className="flex flex-col items-center p-8 sm:p-12">
              <div className="flex size-[88px] items-center justify-center rounded-full bg-blue-50 text-blue-600 mb-6">
                <Stethoscope size={40} />
              </div>
              <div className="text-xl font-bold text-foreground mb-1.5">{inProgressRecord ? "继续进行中的训练" : "开始新的病史采集训练"}</div>
              <div className="text-sm text-muted-foreground max-w-[360px] text-center mb-4">
                {inProgressRecord ? "你有一个进行中的训练，点击下方按钮继续。" : "选择虚拟患者，系统模拟真实护理问诊场景，训练结束后自动评分并提供反馈。"}
              </div>
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-50 text-blue-600 rounded-full text-xs font-medium mb-6">
                <BookOpen size={14} /> 病例库：{cases.length} 例可用
              </div>
              <Button size="lg" className="px-[52px]" onClick={() => (inProgressRecord ? navigate(`/training/${inProgressRecord.id}`) : navigate("/cases"))}>
                {inProgressRecord ? "继续训练" : "开始新的病史采集训练"}
              </Button>
              {!inProgressRecord && <div className="text-xs text-muted-foreground mt-2.5">约 20 分钟完成一次训练</div>}
            </CardContent>
          </Card>

          {recentCases.length > 0 && (
            <Card size="sm">
              <CardHeader className="flex-row items-center justify-between border-b pb-4">
                <CardTitle className="flex items-center gap-2">
                  <BookOpen size={17} />
                  推荐病例
                </CardTitle>
                <CardAction>
                  <Button variant="link" size="sm" onClick={() => navigate("/cases")}>
                    查看全部 →
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="flex flex-col gap-1">
                  {recentCases.map((c) => {
                    const p = getPatientSummary(c.patient_summary);
                    const d = c.difficulty || 1;
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-2.5 p-2.5 rounded-lg cursor-pointer transition-colors hover:bg-muted/50"
                        onClick={() => navigate("/cases")}
                      >
                        <div className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Stethoscope size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-foreground">
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
                        <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {records.length > 0 && (
            <Card size="sm">
              <CardHeader className="flex-row items-center justify-between border-b pb-4">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList size={17} />
                  最近训练记录
                </CardTitle>
                <CardAction>
                  <Button variant="link" size="sm" onClick={() => navigate("/history")}>
                    查看全部 →
                  </Button>
                </CardAction>
              </CardHeader>
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>病例</TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>得分</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.slice(0, 5).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.case_name}</TableCell>
                        <TableCell className="text-muted-foreground">{new Date(r.start_time).toLocaleDateString("zh-CN")}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "completed" ? "success" : "info"}>{r.status === "completed" ? "已完成" : "进行中"}</Badge>
                        </TableCell>
                        <TableCell className={cn("font-semibold", r.score_total != null ? "text-primary" : "text-muted-foreground")}>
                          {r.score_total != null ? `${r.score_total}分` : "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Button variant="link" size="sm" onClick={() => navigate(`/record/${r.id}`)}>
                              详情
                            </Button>
                            {r.status === "in_progress" && (
                              <Button variant="link" size="sm" onClick={() => navigate(`/training/${r.id}`)}>
                                继续训练
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card size="sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Award size={14} />
                最新反馈
              </CardTitle>
            </CardHeader>
            <CardContent>
              {latestCompleted ? (
                <>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-semibold text-foreground">{latestCompleted.case_name}</span>
                    <span className="text-xs text-muted-foreground">{new Date(latestCompleted.start_time).toLocaleDateString("zh-CN")}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mb-3">
                    <span className="text-3xl font-extrabold text-primary">{latestCompleted.score_total}</span>
                    <span className="text-xs text-muted-foreground">分</span>
                    <Badge variant={(latestCompleted.score_total ?? 0) >= 70 ? "success" : "warning"} className="ml-1.5">
                      {(latestCompleted.score_total ?? 0) >= 85
                        ? "优秀"
                        : (latestCompleted.score_total ?? 0) >= 70
                          ? "良好"
                          : (latestCompleted.score_total ?? 0) >= 60
                            ? "一般"
                            : "待提高"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-1 mb-2">
                    <div className="py-1.5 px-2.5 bg-muted rounded-md text-center">
                      <span className="text-xs text-muted-foreground">沟通技能</span>
                      <span className="block text-sm font-bold text-blue-600">
                        {(latestCompleted as { score?: ScoreData }).score?.detail_scores?.沟通技能?.score ?? "-"}
                        <span className="text-xs text-muted-foreground">
                          /{(latestCompleted as { score?: ScoreData }).score?.detail_scores?.沟通技能?.max ?? "?"}
                        </span>
                      </span>
                    </div>
                    <div className="py-1.5 px-2.5 bg-muted rounded-md text-center">
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
                    <Button size="sm" onClick={() => navigate(`/record/${latestCompleted.id}`)}>
                      查看完整报告
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2.5 p-3.5 border border-dashed border-border rounded-lg bg-muted/50 text-muted-foreground">
                  <Target size={18} className="text-primary shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-sm text-foreground mb-0.5">还没有训练记录</strong>
                    <span className="block text-xs leading-relaxed">完成第一次病史采集训练后，这里将显示你的评分结果和改进建议。</span>
                    <Button variant="outline" size="sm" className="mt-2.5" onClick={() => navigate("/cases")}>
                      去训练 →
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageCircle size={14} />
                快速提问
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-1.5 mb-2 qa-quick-row">
                <input
                  className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 focus:bg-background placeholder:text-muted-foreground/50"
                  placeholder="输入护理专业问题..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                      navigate(`/qa?q=${encodeURIComponent((e.target as HTMLInputElement).value.trim())}`);
                    }
                  }}
                />
                <Button
                  size="icon"
                  onClick={() => {
                    const el = document.querySelector(".qa-quick-row input") as HTMLInputElement;
                    if (el?.value.trim()) navigate(`/qa?q=${encodeURIComponent(el.value.trim())}`);
                  }}
                >
                  <ArrowRight size={16} />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_QA_HINTS.map((h, i) => (
                  <span
                    key={i}
                    className="text-xs text-primary bg-blue-50 px-2 py-0.5 rounded-md cursor-pointer hover:bg-blue-100 transition-colors"
                    onClick={() => navigate(`/qa?q=${encodeURIComponent(h)}`)}
                  >
                    {h}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp size={14} />
                本周训练
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <div className="flex-1 text-center py-2.5 bg-muted rounded-lg">
                  <div className="text-xl font-bold text-primary">{durationStats?.total_sessions ?? 0}</div>
                  <div className="text-xs text-muted-foreground">训练次数</div>
                </div>
                <div className="flex-1 text-center py-2.5 bg-muted rounded-lg">
                  <div className="text-xl font-bold text-teal-700">{durationStats?.total_minutes ?? 0}</div>
                  <div className="text-xs text-muted-foreground">累计分钟</div>
                </div>
              </div>
            </CardContent>
          </Card>
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
            <Button onClick={() => navigate("/admin")}>
              <Settings size={16} /> 管理后台
            </Button>
            <Button variant="outline" onClick={handleExport}>
              <Download size={16} /> 导出CSV
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 mb-6">
        <StatCard icon={Users} value={stats?.total_students ?? "-"} label="学生总数" color="blue" onClick={() => navigate("/admin")} />
        <StatCard icon={ClipboardList} value={stats?.total_records ?? "-"} label="总训练次数" color="teal" onClick={() => navigate("/history")} />
        <StatCard icon={CheckCircle} value={stats?.completed_records ?? "-"} label="已完成训练" color="green" />
        <StatCard icon={Star} value={stats?.average_score ?? "-"} label="平均得分" color="amber" onClick={() => navigate("/stats")} />
        <StatCard icon={Clock} value={stats?.avg_duration_min ?? "-"} label="平均时长(分钟)" color="blue" />
      </div>

      <TrainingDurationChart />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] items-start mt-6">
        <Card size="sm">
          <CardHeader className="flex-row items-center justify-between border-b pb-4">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList size={17} />
              最近训练动态
            </CardTitle>
            <CardAction>
              <Button variant="link" size="sm" onClick={() => navigate("/history")}>
                查看全部 →
              </Button>
            </CardAction>
          </CardHeader>
          {recentRecords.length > 0 ? (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>学生</TableHead>
                    <TableHead>病例</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead>得分</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRecords.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.user_display_name}</TableCell>
                      <TableCell>{r.case_name}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "completed" ? "success" : "info"}>{r.status === "completed" ? "已完成" : "进行中"}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{new Date(r.start_time).toLocaleString("zh-CN")}</TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell>
                        <Button variant="link" size="sm" onClick={() => navigate(`/record/${r.id}`)}>
                          详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <CardContent className="text-center py-10 text-muted-foreground">
              <EmptyState icon={ClipboardList} title="暂无训练记录" />
            </CardContent>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card size="sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">快捷入口</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                <Button variant="outline" className="justify-start" onClick={() => navigate("/history")}>
                  <ClipboardList size={14} /> 训练记录管理
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => navigate("/admin/users")}>
                  <Users size={14} /> 学生账号管理
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => navigate("/admin/cases")}>
                  <BookOpen size={14} /> 病例库管理
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => navigate("/admin/llm")}>
                  <TrendingUp size={14} /> LLM 调用监控
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">数据概况</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 text-sm">
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
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
