import { motion } from "motion/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Award, BarChart3, BookOpen, ClipboardCheck, ClipboardList, Clock, Home, Megaphone, Play, RotateCcw, Star, Target, TrendingUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { abandonRecord, getCases, getNotifications, getRecords, markNotificationRead, startTraining } from "@/api";
import { getStudentAssignments, startAssignment } from "@/api/assignments";
import { getStudentRanking, getTrends } from "@/api/stats";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Pagination from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import StatCard from "@/components/ui/stat-card";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import useAuthStore from "@/stores/authStore";
import { cn } from "@/lib/utils";

type CaseBrief = components["schemas"]["CaseBrief"];
type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];
type TrainingNotificationItem = components["schemas"]["TrainingNotificationItem"];

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };
const LIMIT = 50;

const CAP_COLORS: Record<string, string> = {
  physical_exam: "bg-purple-50 text-purple-700",
  nursing_record: "bg-teal-50 text-teal-700",
  quiz: "bg-blue-50 text-blue-700",
};

function getPatientSummary(ps: CaseBrief["patient_summary"]): { gender?: string; age?: number; chief_complaint?: string } {
  if (ps && typeof ps === "object") return ps as { gender?: string; age?: number; chief_complaint?: string };
  return {};
}

function Stars({ level }: { level?: number | null }) {
  const lvl = level && DIFFICULTY_LABELS[level] ? level : 1;
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3].map((i) => (
        <Star key={i} size={11} fill={i <= lvl ? "#f59e0b" : "none"} color={i <= lvl ? "#f59e0b" : "#d1d5db"} />
      ))}
    </span>
  );
}

function CapBadges({ caps }: { caps: Record<string, boolean> | undefined }) {
  if (!caps) return null;
  const enabled = Object.entries(ALL_CAPABILITIES)
    .filter(([, d]) => d.tier === "toggleable")
    .filter(([k]) => caps[k]);
  if (enabled.length === 0) return null;
  return (
    <div className="flex gap-1 flex-wrap">
      {enabled.map(([key, def]) => (
        <span key={key} className={cn("text-xs px-1.5 py-0.5 rounded font-medium", CAP_COLORS[key] ?? "bg-muted text-muted-foreground")}>
          {def.label}
        </span>
      ))}
    </div>
  );
}

export default function TrainingSelect() {
  const [tab, setTab] = useState<"home" | "self" | "assignments">("home");
  const [difficultyFilter, setDifficultyFilter] = useState(0);
  const { searchInput, debouncedValue: search, handleSearchChange } = useDebouncedSearch("", 300);
  const [offset, setOffset] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const user = useAuthStore((s) => s.user);
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<Set<number>>(() => new Set());

  const { data: casesData, isLoading: casesLoading, isError: casesError } = useQuery({
    queryKey: queryKeys.cases.list({ difficulty: difficultyFilter, offset, search }),
    queryFn: () => getCases({ offset, limit: LIMIT, ...(difficultyFilter > 0 ? { difficulty: difficultyFilter } : {}), ...(search ? { name: search } : {}) }).then((r) => r.data),
    staleTime: 5 * 60_000, placeholderData: keepPreviousData, enabled: tab === "self",
  });

  const { data: assignmentsData } = useQuery({
    queryKey: queryKeys.assignments.student,
    queryFn: () => getStudentAssignments().then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: recordsData } = useQuery({
    queryKey: queryKeys.training.records({ limit: 50, offset: 0 }),
    queryFn: () => getRecords({ limit: 50, offset: 0 }).then((r) => r.data),
    staleTime: 30_000,
  });

  const records = recordsData?.items ?? [];
  const assignments = (assignmentsData ?? []) as Array<{
    id: string; title: string; case_name: string; status: string;
    end_time: string; record_id?: number | null; score_total?: number | null;
  }>;

  const inProgressCount = useMemo(() => records.filter((r) => r.status === "in_progress").length, [records]);
  const completedCount = useMemo(() => records.filter((r) => r.status === "completed").length, [records]);
  const pendingAssignments = useMemo(
    () => assignments.filter((a) => a.status === "in_progress" && (!a.end_time || new Date(a.end_time) >= new Date())),
    [assignments],
  );

  // ── Notifications (home tab) ──
  const { data: notifData } = useQuery({
    queryKey: queryKeys.notifications.recent(),
    queryFn: () => getNotifications({ limit: 3 }).then((r) => r.data),
    staleTime: 30_000,
  });
  const recentNotifs = useMemo(
    () => (notifData?.items ?? [])
      .filter((n) => !n.is_read && !dismissedNotificationIds.has(n.id))
      .slice(0, 2),
    [notifData?.items, dismissedNotificationIds],
  );
  const dismissNotificationMutation = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onMutate: (id) => {
      setDismissedNotificationIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    onError: (_error, id) => {
      setDismissedNotificationIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.error("关闭通知失败，请重试");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });

  // ── Training stats (home tab) ──
  const { data: ranking } = useQuery({
    queryKey: queryKeys.stats.ranking({}),
    queryFn: () => getStudentRanking().then((r) => r.data),
    staleTime: 60_000,
  });
  const myStats = ranking?.items?.[0];
  const { data: trends } = useQuery({
    queryKey: queryKeys.stats.trends("month"),
    queryFn: () => getTrends().then((r) => r.data),
    staleTime: 60_000,
  });
  const trendItems = trends?.daily ?? [];

  const inProgressByCase = useMemo(() => {
    const map = new Map<number, TrainingRecordBrief>();
    for (const r of records) {
      if (r.status === "in_progress" && !map.has(r.case_id)) map.set(r.case_id, r);
    }
    return map;
  }, [records]);

  type StartResponse = components["schemas"]["TrainingStartResponse"];
  const startMutation = useMutation({
    mutationFn: ({ caseId, timeLimit }: { caseId: number; timeLimit: number }) => startTraining(caseId, {}, timeLimit),
    onSuccess: (res) => {
      const data: StartResponse = res.data;
      if (data.session) queryClient.setQueryData(queryKeys.training.detail(String(data.record_id)), data.session);
      navigate(`/training/${data.record_id}`);
    },
    onError: () => toast.error("开始训练失败，请重试"),
  });
  const handleRestart = async (c: CaseBrief, rec: TrainingRecordBrief) => {
    const ok = await confirm({
      title: "重新开始训练", message: `放弃「${c.name}」当前未完成的训练并重新开始？`, confirmLabel: "放弃并重开", danger: true,
    });
    if (!ok) return;
    try { await abandonRecord(rec.id); } catch { toast.apiError(null, "放弃记录失败"); return; }
    queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
    startMutation.mutate({ caseId: c.id, timeLimit: c.time_limit_minutes ?? 20 });
  };
  const handleStartAssignment = async (assignmentId: string) => {
    try {
      const res = await startAssignment(assignmentId);
      const data = res.data as Record<string, unknown>;
      if (typeof (data as { record_id?: number }).record_id === "number") {
        if (data.session) queryClient.setQueryData(queryKeys.training.detail(String(data.record_id)), data.session);
        navigate(`/training/${(data as { record_id: number }).record_id}`);
      }
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 409) {
        const detail = (err as { response?: { data?: { code?: string; record_id?: number; case_name?: string } } }).response?.data;
        if (detail?.code === "existing_training") {
          const ok = await confirm({
            title: "有进行中的训练",
            message: `你有一个未完成的训练「${detail.case_name ?? "未知"}」。要继续之前的训练，还是放弃并开始新训练？`,
            confirmLabel: "放弃并开始新训练",
            danger: true,
          });
          if (ok) {
            queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
            handleStartAssignment(assignmentId);
          } else if (detail.record_id) {
            navigate(`/training/${detail.record_id}`);
          }
          return;
        }
      }
      toast.apiError(err, "开始作业失败，请刷新后重试");
    }
  };

  const cases = casesData?.items ?? [];
  const total = casesData?.total ?? 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";
  const recentRecords = records.slice(0, 5);
  const primaryInProgress = records.find((r) => r.status === "in_progress");
  const nextAssignment = pendingAssignments[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
          <button onClick={() => setTab("home")}
            className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95", tab === "home" ? "bg-background text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground")}
          ><Home size={14} />首页</button>
          <button onClick={() => setTab("self")}
            className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95", tab === "self" ? "bg-background text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground")}
          ><BookOpen size={14} />自主训练</button>
          <button onClick={() => setTab("assignments")}
            className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95", tab === "assignments" ? "bg-background text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground")}
          ><ClipboardList size={14} />我的作业</button>
        </div>
        {tab === "home" && (
          <span className="text-xs text-muted-foreground">{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</span>
        )}
      </div>

      {tab === "home" && (
        <div className="space-y-4">
          {recentNotifs.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-e2">
              <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-primary/5 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Megaphone size={16} />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">新的训练通知</h2>
                    <p className="text-xs text-muted-foreground">可关闭，关闭后会标记为已读</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => navigate("/notifications")}>
                  查看全部
                </Button>
              </div>
              <div className="divide-y divide-border/70">
                {recentNotifs.map((n: TrainingNotificationItem) => (
                  <div key={n.id} className="flex items-start gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => navigate(n.record_id ? `/training/${n.record_id}` : "/notifications")}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      <p className="truncate text-sm font-medium text-foreground">{n.title}</p>
                      {n.body && (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{n.body}</p>
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => dismissNotificationMutation.mutate(n.id)}
                      disabled={dismissNotificationMutation.isPending}
                      aria-label={`关闭通知：${n.title}`}
                    >
                      <X size={15} />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
            <div className="relative overflow-hidden rounded-2xl ring-1 ring-foreground/10 bg-card p-5 shadow-e2 sm:p-6">
              <div className="absolute inset-0 bg-grid-medical opacity-80" />
              <div className="absolute -right-12 -top-16 size-48 rounded-full bg-primary/10 blur-3xl" />
              <div className="relative flex min-h-[220px] flex-col justify-between gap-8">
                <div>
                  <p className="text-sm font-medium text-primary">{greeting}，{user?.display_name || "同学"}</p>
                  <h1 className="mt-3 max-w-2xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                    {primaryInProgress ? "继续完成这次护理问诊" : nextAssignment ? "先处理最近一项训练作业" : "开始一次新的护理模拟训练"}
                  </h1>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                    {primaryInProgress
                      ? `当前未完成病例：${primaryInProgress.case_name}。先回到对话，再生成评分。`
                      : nextAssignment
                        ? `待完成作业：${nextAssignment.title} · ${nextAssignment.case_name}`
                        : "选择一个病例进入沉浸式问诊，完成后查看评分和改进建议。"}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  {primaryInProgress ? (
                    <Button size="lg" onClick={() => navigate(`/training/${primaryInProgress.id}`)} className="sm:w-fit">
                      <Play size={16} />继续训练
                    </Button>
                  ) : nextAssignment ? (
                    <Button size="lg" onClick={() => handleStartAssignment(nextAssignment.id)} className="sm:w-fit">
                      <Play size={16} />开始作业
                    </Button>
                  ) : (
                    <Button size="lg" onClick={() => setTab("self")} className="sm:w-fit">
                      <BookOpen size={16} />选择病例
                    </Button>
                  )}
                  {(primaryInProgress || nextAssignment) && (
                    <Button variant="outline" size="lg" onClick={() => setTab("self")} className="sm:w-fit">
                      {primaryInProgress ? "选择其他病例" : "自主训练"}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <aside className="rounded-2xl ring-1 ring-foreground/10 bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">待完成作业</h2>
                <button type="button" onClick={() => setTab("assignments")} className="text-xs font-medium text-primary hover:text-primary/80">
                  查看全部
                </button>
              </div>
              {pendingAssignments.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {pendingAssignments.slice(0, 3).map((a: { id: string; title: string; case_name: string; end_time?: string }) => (
                    <div key={a.id} className="rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{a.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {a.case_name}{a.end_time ? ` · ${new Date(a.end_time).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 截止` : ""}
                          </div>
                        </div>
                        <Button size="sm" onClick={() => handleStartAssignment(a.id)}>
                          <Play size={14} />开始
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  暂无待完成作业，可以自主选择病例训练。
                </div>
              )}
            </aside>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><TrendingUp size={16} className="text-muted-foreground" />最近训练</h3>
              {recentRecords.length > 0 ? (
                <div className="space-y-1">
                  {recentRecords.map((r) => (
                    <button key={r.id} type="button" onClick={() => navigate(r.status === "in_progress" ? `/training/${r.id}` : `/record/${r.id}`)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted">
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{r.case_name}</div><div className="text-xs text-muted-foreground mt-0.5">{new Date(r.start_time).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · 问诊</div></div>
                      <div className="shrink-0 ml-3">{r.status === "completed" && r.score_total != null ? <span className="text-sm font-semibold text-primary tabular-nums">{r.score_total} 分</span> : r.status === "in_progress" ? <Badge variant="info">进行中</Badge> : null}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  还没有训练记录。先从一个病例开始。
                </div>
              )}
            </div>

            <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><Target size={16} className="text-muted-foreground" />训练概览</h3>
              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant="ghost" onClick={() => { if (inProgressCount > 0) navigate("/history?status=in_progress"); }}
                  className={cn("h-auto flex-col items-start rounded-lg bg-warning/60 p-3 text-left transition-colors", inProgressCount > 0 && "hover:bg-warning")}>
                  <Play size={16} className="mb-2 text-warning-foreground" />
                  <div><div className="text-lg font-bold tabular-nums">{inProgressCount}</div><div className="text-xs text-muted-foreground">进行中</div></div>
                </Button>
                <Button type="button" variant="ghost" onClick={() => { if (completedCount > 0) navigate("/history?status=completed"); }}
                  className={cn("h-auto flex-col items-start rounded-lg bg-success/60 p-3 text-left transition-colors", completedCount > 0 && "hover:bg-success")}>
                  <ClipboardCheck size={16} className="mb-2 text-success-foreground" />
                  <div><div className="text-lg font-bold tabular-nums">{completedCount}</div><div className="text-xs text-muted-foreground">已完成</div></div>
                </Button>
                <Button type="button" variant="ghost" onClick={() => { if (pendingAssignments.length > 0) setTab("assignments"); }}
                  className={cn("h-auto flex-col items-start rounded-lg bg-danger/60 p-3 text-left transition-colors", pendingAssignments.length > 0 && "hover:bg-danger")}>
                  <BookOpen size={16} className="mb-2 text-danger-foreground" />
                  <div><div className="text-lg font-bold tabular-nums">{pendingAssignments.length}</div><div className="text-xs text-muted-foreground">作业</div></div>
                </Button>
              </div>
              {myStats && (
                <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-1">
                  <StatCard icon={Target} label="完成训练" value={myStats.total_sessions ?? 0} color="teal" className="p-3" />
                  <StatCard icon={Award} label="平均得分" value={myStats.avg_score != null ? `${myStats.avg_score}分` : "--"} color="green" className="p-3" />
                  <StatCard icon={TrendingUp} label="排名" value={myStats.rank ? `第${myStats.rank}名` : "--"} color="blue" className="p-3" />
                  <StatCard icon={Clock} label="总时长" value={myStats.total_minutes ? `${myStats.total_minutes}分钟` : "--"} color="amber" className="p-3" />
                </div>
              )}
              <div className="mt-4 border-t border-border pt-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-medium"><BarChart3 size={16} className="text-muted-foreground" />进步趋势</h4>
                {trendItems.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {trendItems.slice(0, 8).map((item, index) => (
                      <div key={`${String(item.period_label ?? "period")}-${index}`} className="rounded-lg bg-muted/70 p-2 text-center">
                        <div className="text-sm font-semibold tabular-nums">{item.average_score != null ? String(item.average_score) : "--"}</div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.period_label != null ? String(item.period_label) : `第${index + 1}周`}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    完成更多训练后显示趋势
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ═══ Tab: 自主训练 ═══ */}
      {tab === "self" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {[0, 1, 2, 3].map((d) => (
              <Button key={d} type="button" variant={difficultyFilter === d ? "default" : "ghost"} size="xs" onClick={() => { setDifficultyFilter(d); setOffset(0); }}
              >{d === 0 ? "全部难度" : DIFFICULTY_LABELS[d]}</Button>
            ))}
            <div className="flex-1" />
            <div className="w-44">
              <SearchInput value={searchInput} onChange={(value) => { handleSearchChange(value); setOffset(0); }} placeholder="搜索病例…" />
            </div>
          </div>
          {casesLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <LoadingSkeleton key={i} variant="card" />)}</div>
          ) : casesError ? (
            <EmptyState icon={AlertTriangle} title="加载失败" description="请检查网络后重试" action={<Button variant="outline" size="sm" onClick={() => window.location.reload()}>重试</Button>} />
          ) : cases.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="暂无可用病例" description={search ? "没有匹配的病例" : "管理员尚未开放自主练习病例"} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cases.map((c, idx) => {
                  const summary = getPatientSummary(c.patient_summary);
                  const inProgress = inProgressByCase.get(c.id);
                  return (
                    <motion.div key={c.id}
                      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/30"
                      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: idx * 0.04, ease: "easeOut" }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold truncate">{c.name}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {[summary.gender, summary.age != null ? `${summary.age}岁` : null].filter(Boolean).join(" · ")}
                            {summary.chief_complaint && <> · {summary.chief_complaint.slice(0, 30)}</>}
                          </p>
                        </div>
                        <Stars level={c.difficulty} />
                      </div>
                      <CapBadges caps={c.capabilities} />
                      {inProgress ? (
                        <div className="mt-auto flex gap-2">
                          <Button className="flex-1" size="sm" onClick={() => navigate(`/training/${inProgress.id}`)}><Play size={14} />继续训练</Button>
                          <Button variant="outline" size="sm" onClick={() => handleRestart(c, inProgress)} disabled={startMutation.isPending}><RotateCcw size={14} /></Button>
                        </div>
                      ) : (
                        <Button className="mt-auto w-full" size="sm" onClick={() => startMutation.mutate({ caseId: c.id, timeLimit: c.time_limit_minutes ?? 20 })} disabled={startMutation.isPending}>开始训练</Button>
                      )}
                    </motion.div>
                  );
                })}
              </div>
              {total > LIMIT && <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />}
            </>
          )}
        </>
      )}

      {/* ═══ Tab: 我的作业 ═══ */}
      {tab === "assignments" && (
        !assignmentsData ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <LoadingSkeleton key={i} variant="card" />)}</div>
        ) : assignments.length === 0 ? (
          <EmptyState icon={ClipboardList} title="暂无作业" description="教师尚未布置作业，或所有作业已过期" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {assignments.map((a) => {
              const isExpired = a.end_time && new Date(a.end_time) < new Date();
              const isCompleted = a.status === "completed";
              const isInProgress = a.status === "in_progress";
              return (
                <div key={a.id} className={cn("flex flex-col gap-3 rounded-lg border p-4 transition-colors", isExpired ? "border-danger bg-danger/30" : isCompleted ? "border-success bg-success/30" : "border-border bg-card hover:border-primary/30")}>
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold truncate flex-1">{a.title}</h3>
                      {isExpired && <Badge variant="danger">已过期</Badge>}
                      {isCompleted && <Badge variant="success">已完成</Badge>}
                      {!isExpired && !isCompleted && <Badge variant="secondary">待完成</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{a.case_name}{a.score_total != null && <> · 得分 {a.score_total}</>}</p>
                  </div>
                  <div className="mt-auto">
                    {isInProgress && a.record_id ? (
                      <Button size="sm" className="w-full" onClick={() => navigate(`/training/${a.record_id}`)}><Play size={14} />继续训练</Button>
                    ) : !isExpired && isCompleted ? (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => handleStartAssignment(a.id)}><RotateCcw size={14} />重新训练</Button>
                    ) : !isExpired && !isCompleted ? (
                      <Button size="sm" className="w-full" onClick={() => handleStartAssignment(a.id)}><Play size={14} />开始作业</Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
