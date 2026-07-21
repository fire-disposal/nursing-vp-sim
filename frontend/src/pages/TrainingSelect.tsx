import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ambulance, Search, Star, Stethoscope, User, X } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCases, getProfiles, startTraining } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Pagination from "@/components/ui/pagination";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { cn } from "@/utils/cn";

type CaseBrief = components["schemas"]["CaseBrief"];

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };
const LIMIT = 50;

const CAPABILITY_COLORS: Record<string, string> = {
  patient_initiative: "bg-amber-50 text-amber-600",
  physical_exam: "bg-purple-50 text-purple-600",
  nursing_record: "bg-teal-50 text-teal-600",
};

const TYPE_LABELS: Record<string, { label: string; icon: typeof Stethoscope }> = {
  history_taking: { label: "病史采集", icon: Stethoscope },
  triage: { label: "预检分诊", icon: Ambulance },
};

interface PatientSummary { gender?: string; age?: number; chief_complaint?: string }

function getPatientSummary(ps: CaseBrief["patient_summary"]): PatientSummary {
  if (ps && typeof ps === "object") return ps as PatientSummary;
  return {};
}

function DifficultyStars({ level }: { level?: number | null }) {
  const lvl = level && DIFFICULTY_LABELS[level] ? level : 1;
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3].map((i) => (
        <Star key={i} size={12} fill={i <= lvl ? "#f59e0b" : "none"} color={i <= lvl ? "#f59e0b" : "#d1d5db"} />
      ))}
    </span>
  );
}

export default function TrainingSelect() {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState(0);
  const { searchInput, debouncedValue: search, handleSearchChange } = useDebouncedSearch("", 300);
  const [offset, setOffset] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();
  const startingCaseRef = useRef<number | null>(null);

  const { data: profiles = [] } = useQuery({
    queryKey: queryKeys.profiles.all,
    queryFn: getProfiles,
    staleTime: 30 * 60_000,
  });

  const { data: casesData, isLoading, isError } = useQuery({
    queryKey: queryKeys.cases.list({ type: selectedType, difficulty: difficultyFilter, offset, search }),
    queryFn: () =>
      getCases({
        offset,
        limit: LIMIT,
        ...(selectedType ? { training_type: selectedType } : {}),
        ...(difficultyFilter > 0 ? { difficulty: difficultyFilter } : {}),
        ...(search ? { name: search } : {}),
      }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const startMutation = useMutation({
    mutationFn: ({ caseId, timeLimit }: { caseId: number; timeLimit: number }) => {
      startingCaseRef.current = caseId;
			return startTraining(caseId, {}, timeLimit);
    },
    onSuccess: (res: { data: { record_id: number } }) => {
      startingCaseRef.current = null;
      navigate(`/training/${res.data.record_id}`);
    },
    onError: () => {
      startingCaseRef.current = null;
      toast.error("开始训练失败，请重试");
    },
  });

  const cases = casesData?.items ?? [];
  const total = casesData?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">病例列表</h1>
        <p className="text-sm text-muted-foreground mt-0.5">选择病例开始护理模拟训练，系统自动评分</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setSelectedType(null); setOffset(0); }}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors",
              selectedType === null ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            全部
          </button>
          {profiles.map((p) => {
            const meta = TYPE_LABELS[p.type] ?? TYPE_LABELS.history_taking;
            const Icon = meta.icon;
            const count = p.case_count ?? 0;
            return (
              <button
                key={p.type}
                type="button"
                onClick={() => { setSelectedType(p.type); setOffset(0); }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors",
                  selectedType === p.type
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={14} />
                {meta.label}
                <span className="text-[11px] opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {[0, 1, 2, 3].map((d) => (
            <button key={d} type="button" onClick={() => { setDifficultyFilter(d); setOffset(0); }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                difficultyFilter === d
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {d === 0 ? "全部难度" : DIFFICULTY_LABELS[d]}
            </button>
          ))}
          <div className="relative w-36 sm:w-44">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="text" value={searchInput} onChange={(e) => { handleSearchChange(e.target.value); setOffset(0); }}
              placeholder="搜索…"
              className="w-full h-8 pl-8 pr-2 rounded-md border border-border bg-background text-xs outline-none focus:border-primary/50"
            />
            {search && (
              <button onClick={() => handleSearchChange("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <LoadingSkeleton key={i} variant="card" />)}
        </div>
      ) : isError ? (
        <EmptyState icon={AlertTriangle} title="加载失败" description="请检查网络后重试" action={<Button variant="outline" size="sm" onClick={() => window.location.reload()}>重试</Button>} />
      ) : cases.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="暂无可用病例" description={search ? "没有匹配的病例" : "管理员尚未开放自主练习病例，请联系教师或管理员配置"} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cases.map((c) => {
              const summary = getPatientSummary(c.patient_summary);
              const isStarting = startMutation.isPending && startingCaseRef.current === c.id;
              const typeMeta = TYPE_LABELS[c.training_type] ?? TYPE_LABELS.history_taking;
              const TypeIcon = typeMeta.icon;
              const caps = c.capabilities ?? {};
              const enabledCaps = Object.entries(caps).filter(([, v]) => v).map(([k]) => k);
              return (
                <div key={c.id} className="group flex flex-col gap-3 rounded-xl border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <TypeIcon size={16} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold leading-snug truncate">{c.name}</h3>
                        <p className="text-[10px] text-muted-foreground">{typeMeta.label}</p>
                      </div>
                    </div>
                    <DifficultyStars level={c.difficulty} />
                  </div>

					{(summary.gender || typeof summary.age === "number" || summary.chief_complaint) && (
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						{summary.gender && <span className="inline-flex items-center gap-1"><User size={12} />{summary.gender === "男" ? "男性" : summary.gender === "女" ? "女性" : summary.gender}</span>}
						{typeof summary.age === "number" && <span>{summary.age}岁</span>}
						{summary.chief_complaint && <span className="truncate max-w-[200px]" title={summary.chief_complaint}>主诉：{summary.chief_complaint}</span>}
					</div>
				)}

                  <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>

                  <div className="flex gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px] px-1.5">{(c.difficulty && DIFFICULTY_LABELS[c.difficulty]) || "初级"}</Badge>
                    {enabledCaps.map((key) => {
                      const capDef = ALL_CAPABILITIES[key];
                      const color = CAPABILITY_COLORS[key] ?? "bg-muted text-muted-foreground";
                      return (
                        <span key={key} className={cn("text-[10px] px-1.5 py-0.5 rounded", color)}>{capDef?.label ?? key}</span>
                      );
                    })}
                  </div>

                  <Button
                    className="mt-auto w-full"
                    onClick={() => startMutation.mutate({ caseId: c.id, timeLimit: c.time_limit_minutes ?? 20 })}
                    disabled={startMutation.isPending}
                  >
                    {isStarting ? "启动中…" : "开始训练"}
                  </Button>
                </div>
              );
            })}
          </div>

          {total > LIMIT && (
            <div className="rounded-xl border bg-card px-4 py-3">
              <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
