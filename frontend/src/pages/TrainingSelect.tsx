import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ambulance, Lightbulb, Search, Star, Stethoscope, User, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCases, getProfiles, startTraining } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import type { TrainingTypeInfo } from "@/training/types";
import { cn } from "@/utils/cn";
import { TrainingConfigSheet } from "@/components/training/TrainingConfigSheet";

type CaseBrief = components["schemas"]["CaseBrief"];

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };
const LIMIT = 50;

interface PatientSummary { gender?: string; age?: number; chief_complaint?: string }

function getPatientSummary(ps: CaseBrief["patient_summary"]): PatientSummary {
  if (ps && typeof ps === "object") return ps as PatientSummary;
  return {};
}

function getTypeLabel(type: string, profiles: TrainingTypeInfo[]): string {
  return profiles.find((x) => x.type === type)?.label ?? (type === "triage" ? "预检分诊" : "病史采集");
}

const TYPE_META: Record<string, { icon: typeof Stethoscope; color: string; features: { label: string; color: string }[] }> = {
  history_taking: {
    icon: Stethoscope,
    color: "from-blue-500/10 to-blue-500/5",
    features: [
      { label: "问诊", color: "bg-blue-50 text-blue-600" },
      { label: "查体", color: "bg-purple-50 text-purple-600" },
      { label: "评分", color: "bg-green-50 text-green-600" },
    ],
  },
  triage: {
    icon: Ambulance,
    color: "from-red-500/10 to-red-500/5",
    features: [
      { label: "快速评估", color: "bg-orange-50 text-orange-600" },
      { label: "分诊", color: "bg-red-50 text-red-600" },
    ],
  },
};

// ── Difficulty stars ──
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

// ── Component ──
export default function TrainingSelect() {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState(0);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedCase, setSelectedCase] = useState<CaseBrief | null>(null);
  const [hintDismissed, setHintDismissed] = useState(() => localStorage.getItem("training_hint_dismissed") === "1");
  const navigate = useNavigate();
  const toast = useToast();

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
      }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const startMutation = useMutation({
    mutationFn: ({ caseId, features, timeLimit }: { caseId: number; features: Record<string, boolean>; timeLimit: number }) =>
      startTraining(caseId, null, features, timeLimit),
    onSuccess: (res: { data: { record_id: number } }) => navigate(`/training/${res.data.record_id}`),
    onError: () => toast.error("开始训练失败，请重试"),
  });

  const cases = casesData?.items ?? [];
  const total = casesData?.total ?? 0;

  return (
    <>
      <PageHeader title="训练中心" icon={selectedType === "triage" ? Ambulance : Stethoscope}
        subtitle={selectedType ? "选择虚拟患者病例开始训练" : "选择训练类型和虚拟患者，系统将模拟真实护理场景"}
        backTo="/home"
      />

      <div className="space-y-6">
        {/* Hint */}
        {!hintDismissed && (
          <div className="relative rounded-xl border border-transparent bg-warning p-4">
            <div className="flex gap-3 items-start">
              <Lightbulb size={20} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-warning-foreground">
                <span className="font-semibold">提示：</span>选择训练类型和病例后，系统会模拟真实患者，你通过对话完成问诊或分诊。训练结束后自动评分。
              </p>
            </div>
            <button onClick={() => { localStorage.setItem("training_hint_dismissed", "1"); setHintDismissed(true); }}
              className="absolute top-2 right-2 size-8 flex items-center justify-center rounded-lg hover:bg-amber-200/50" aria-label="关闭">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Training type selector */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">选择训练类型</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {profiles.map((p) => {
              const meta = TYPE_META[p.type] ?? TYPE_META.history_taking;
              const Icon = meta.icon;
              const isSelected = selectedType === p.type;
              const count = (p as any).case_count ?? 0;
              return (
                <button key={p.type} type="button" onClick={() => { setSelectedType(p.type); setOffset(0); setSearch(""); }}
                  className={cn(
                    "relative flex flex-col items-start gap-3 min-w-[200px] flex-1 rounded-xl border p-5 text-left transition-all",
                    isSelected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border bg-card hover:border-primary/30 hover:shadow-md",
                  )}
                >
                  <div className={cn("absolute inset-0 rounded-xl opacity-30", "bg-gradient-to-br", meta.color)} />
                  <div className={cn("relative flex size-12 items-center justify-center rounded-xl",
                    isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                    <Icon size={24} />
                  </div>
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold">{p.label}</h3>
                      <Badge variant={isSelected ? "default" : "outline"}>{count} 例</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">{p.description}</p>
                    <div className="flex gap-2 mt-2">
                      {meta.features.map((f) => (
                        <span key={f.label} className={cn("text-[10px] px-2 py-0.5 rounded-full", f.color)}>{f.label}</span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Filters — only when type selected */}
        {selectedType && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              {[0, 1, 2, 3].map((d) => (
                <button key={d} type="button" onClick={() => { setDifficultyFilter(d); setOffset(0); }}
                  className={cn(
                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                    difficultyFilter === d
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {d === 0 ? "全部" : DIFFICULTY_LABELS[d]}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索病例名称…"
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Case cards */}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <LoadingSkeleton key={i} variant="card" />)}
          </div>
        ) : isError ? (
          <EmptyState icon={AlertTriangle} title="加载失败" description="请检查网络后重试" />
        ) : !selectedType ? (
          <EmptyState icon={Stethoscope} title="请先选择一种训练类型" description="选择后即可浏览对应的虚拟患者病例" />
        ) : cases.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="暂无病例" description={search ? "没有匹配的病例名称" : "该类型暂无可用病例"} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cases.map((c) => {
                const summary = getPatientSummary(c.patient_summary);
                const isStarting = startMutation.isPending && selectedCase?.id === c.id;
                const meta = TYPE_META[c.training_type] ?? TYPE_META.history_taking;
                return (
                  <div key={c.id} className="group flex flex-col gap-3 rounded-xl border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <meta.icon size={16} />
                        </div>
                        <h3 className="text-sm font-semibold leading-snug truncate">{c.name}</h3>
                      </div>
                      <DifficultyStars level={c.difficulty} />
                    </div>

                    {/* Patient info */}
                    {summary && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {summary.gender && <span className="inline-flex items-center gap-1"><User size={12} />{summary.gender === "男" ? "男性" : summary.gender === "女" ? "女性" : summary.gender}</span>}
                        {typeof summary.age === "number" && <span>{summary.age}岁</span>}
                        {summary.chief_complaint && <span className="truncate">主诉：{summary.chief_complaint}</span>}
                      </div>
                    )}

                    {/* Description */}
                    <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>

                    {/* Type badges */}
                    <div className="flex gap-1.5">
                      <Badge variant="outline" className="text-[10px] px-1.5">{(c.difficulty && DIFFICULTY_LABELS[c.difficulty]) || "初级"}</Badge>
                      {meta.features.slice(0, 2).map((f) => (
                        <span key={f.label} className={cn("text-[10px] px-1.5 py-0.5 rounded", f.color)}>{f.label}</span>
                      ))}
                    </div>

                    <Button className="mt-auto w-full" onClick={() => setSelectedCase(c)} disabled={startMutation.isPending}>
                      {isStarting ? "启动中…" : "开始训练"}
                    </Button>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {total > LIMIT && (
              <div className="rounded-xl border bg-card px-4 py-3">
                <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Config sheet */}
      {selectedCase && (
        <TrainingConfigSheet
          open={!!selectedCase}
          caseInfo={selectedCase}
          profiles={profiles}
          onClose={() => setSelectedCase(null)}
          onStart={(features, timeLimit) => {
            startMutation.mutate({ caseId: selectedCase.id, features, timeLimit });
            setSelectedCase(null);
          }}
          loading={startMutation.isPending}
        />
      )}
    </>
  );
}
