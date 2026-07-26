import { motion } from "motion/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, ClipboardList, Play, RotateCcw, Search, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { abandonRecord, getCases, getRecords, startTraining } from "@/api";
import { getStudentAssignments, startAssignment } from "@/api/assignments";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Pagination from "@/components/ui/pagination";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { cn } from "@/utils/cn";

type CaseBrief = components["schemas"]["CaseBrief"];
type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };
const LIMIT = 50;

const CAP_COLORS: Record<string, string> = {
  physical_exam: "bg-purple-50 text-purple-700",
  nursing_record: "bg-teal-50 text-teal-700",
  quiz: "bg-blue-50 text-blue-700",
  mews: "bg-amber-50 text-amber-700",
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
  const [tab, setTab] = useState<"self" | "assignments">("self");
  const [difficultyFilter, setDifficultyFilter] = useState(0);
  const { searchInput, debouncedValue: search, handleSearchChange } = useDebouncedSearch("", 300);
  const [offset, setOffset] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();

  const { data: casesData, isLoading, isError } = useQuery({
    queryKey: queryKeys.cases.list({ difficulty: difficultyFilter, offset, search }),
    queryFn: () => getCases({ offset, limit: LIMIT, ...(difficultyFilter > 0 ? { difficulty: difficultyFilter } : {}), ...(search ? { name: search } : {}) }).then((r) => r.data),
    staleTime: 5 * 60_000, placeholderData: keepPreviousData, enabled: tab === "self",
  });

  const { data: assignmentsData } = useQuery({
    queryKey: queryKeys.assignments.student,
    queryFn: () => getStudentAssignments().then((r) => r.data),
    staleTime: 30_000,
  });

  // Auto-default to "assignments" tab when there are pending assignments
  const tabAutoSetRef = useRef(false);
  useEffect(() => {
    if (tabAutoSetRef.current) return;
    const pendingAssignments = (assignmentsData ?? []).filter(
      (a: { status: string }) => a.status === "in_progress",
    );
    if (pendingAssignments.length > 0) {
      setTab("assignments");
    }
    tabAutoSetRef.current = true;
  }, [assignmentsData]);

  const { data: inProgressData } = useQuery({
    queryKey: queryKeys.training.records({ status: "in_progress", limit: 100, offset: 0 }),
    queryFn: () => getRecords({ status: "in_progress", limit: 100, offset: 0 }).then((r) => r.data),
    staleTime: 30_000,
  });

  const inProgressByCase = useMemo(() => {
    const map = new Map<number, TrainingRecordBrief>();
    for (const r of inProgressData?.items ?? []) {
      if (!map.has(r.case_id)) map.set(r.case_id, r);
    }
    return map;
  }, [inProgressData]);

  const startMutation = useMutation({
    mutationFn: ({ caseId, timeLimit }: { caseId: number; timeLimit: number }) => startTraining(caseId, {}, timeLimit),
    onSuccess: (res: { data: { record_id: number } }) => navigate(`/training/${res.data.record_id}`),
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
        navigate(`/training/${(data as { record_id: number }).record_id}`);
      }
    } catch (err: unknown) { toast.apiError(err, "开始作业失败，请刷新后重试"); }
  };

  const cases = casesData?.items ?? [];
  const total = casesData?.total ?? 0;
  const assignments = (assignmentsData ?? []) as Array<{
    id: string; title: string; case_name: string; status: string;
    end_time: string; record_id?: number | null; score_total?: number | null;
  }>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">病例训练</h1>
        <p className="text-sm text-muted-foreground mt-0.5">选择病例开始护理模拟训练，系统自动评分</p>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          onClick={() => setTab("self")}
          className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95", tab === "self" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        ><BookOpen size={14} />自主训练</button>
        <button
          onClick={() => setTab("assignments")}
          className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95", tab === "assignments" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        ><ClipboardList size={14} />我的作业</button>
      </div>

      {tab === "self" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {[0, 1, 2, 3].map((d) => (
              <button key={d} type="button" onClick={() => { setDifficultyFilter(d); setOffset(0); }}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", difficultyFilter === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >{d === 0 ? "全部难度" : DIFFICULTY_LABELS[d]}</button>
            ))}
            <div className="flex-1" />
            <div className="relative w-40">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="text" value={searchInput} onChange={(e) => { handleSearchChange(e.target.value); setOffset(0); }}
                placeholder="搜索病例…" className="h-8 w-full pl-8 pr-6 rounded-md border border-border bg-background text-xs outline-none focus:border-primary/50" />
              {search && <button onClick={() => handleSearchChange("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={12} /></button>}
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <LoadingSkeleton key={i} variant="card" />)}</div>
          ) : isError ? (
            <EmptyState icon={AlertTriangle} title="加载失败" description="请检查网络后重试" action={<Button variant="outline" size="sm" onClick={() => window.location.reload()}>重试</Button>} />
          ) : cases.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="暂无可用病例" description={search ? "没有匹配的病例" : "管理员尚未开放自主练习病例"} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cases.map((c) => {
                  const summary = getPatientSummary(c.patient_summary);
                  const inProgress = inProgressByCase.get(c.id);
                  return (
                    <motion.div
                      key={c.id}
                      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/30"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: cases.indexOf(c) * 0.04, ease: "easeOut" }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold truncate">{c.name}</h3>
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
                <div key={a.id} className={cn("flex flex-col gap-3 rounded-lg border p-4 transition-colors", isExpired ? "border-red-200 bg-red-50/30" : isCompleted ? "border-emerald-200 bg-emerald-50/30" : "border-border bg-card hover:border-primary/30")}>
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold truncate flex-1">{a.title}</h3>
                      {isExpired && <span className="shrink-0 inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">已过期</span>}
                      {isCompleted && <span className="shrink-0 inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">已完成</span>}
                      {!isExpired && !isCompleted && <span className="shrink-0 inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">待完成</span>}
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
