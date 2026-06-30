import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ambulance,
  ClipboardList,
  Lightbulb,
  Star,
  Stethoscope,
  User,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCases, getProfiles, startTraining } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import TrainingConfigModal from "@/components/training/TrainingConfigModal";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import type { TrainingTypeInfo } from "@/training/types";
import { TRAINING_TYPE_CONFIGS } from "@/training/types";
import { cn } from "@/utils/cn";

type CaseBrief = components["schemas"]["CaseBrief"];

const DIFFICULTY_LABELS: Record<number, string> = {
  1: "初级",
  2: "中级",
  3: "高级",
};
const DIFFICULTY_COLORS: Record<number, string> = {
  1: "success",
  2: "warning",
  3: "danger",
};
const LIMIT = 50;

const TYPE_ICONS: Record<string, typeof Stethoscope> = {
  Stethoscope,
  Ambulance,
};

interface PatientSummary {
  gender?: string;
  age?: number;
  chief_complaint?: string;
}

function getPatientSummary(ps: CaseBrief["patient_summary"]): PatientSummary {
  if (ps && typeof ps === "object") return ps as PatientSummary;
  return {};
}

function getTypeLabel(type: string, profiles: TrainingTypeInfo[]): string {
  const p = profiles.find((x) => x.type === type);
  return p?.label ?? (type === "triage" ? "预检分诊" : "病史采集");
}

export default function TrainingSelect() {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedCase, setSelectedCase] = useState<{
    id: number;
    name: string;
    training_type: string;
    difficulty: number;
    description?: string | null;
    patient_summary?: CaseBrief["patient_summary"];
  } | null>(null);
  const [hintDismissed, setHintDismissed] = useState(
    () => localStorage.getItem("training_hint_dismissed") === "1",
  );
  const navigate = useNavigate();
  const toast = useToast();

  const { data: profiles = [] } = useQuery({
    queryKey: queryKeys.profiles.all,
    queryFn: getProfiles,
    staleTime: 30 * 60_000,
  });

  const {
    data: casesData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.cases.list({ type: selectedType, difficulty: difficultyFilter, offset }),
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
    mutationFn: ({
      caseId,
      features,
      timeLimit,
    }: {
      caseId: number;
      features: Record<string, boolean>;
      timeLimit: number;
    }) => startTraining(caseId, null, features, timeLimit),
    onSuccess: (res) => navigate(`/training/${res.data.record_id}`),
    onError: () => toast.error("开始训练失败，请重试"),
  });

  const cases = casesData?.items ?? [];
  const total = casesData?.total ?? 0;

  const handleTypeSelect = (type: string) => {
    if (selectedType === type) return;
    setSelectedType(type);
    setDifficultyFilter(0);
    setOffset(0);
  };

  const getDifficultyStars = (d?: number | null) => {
    const level = d && DIFFICULTY_LABELS[d] ? d : 1;
    return Array.from({ length: 3 }, (_, i) => (
      <Star
        key={i}
        size={12}
        fill={i < level ? "#f59e0b" : "none"}
        color={i < level ? "#f59e0b" : "#d1d5db"}
      />
    ));
  };

  const typeColorMap: Record<string, string> = {
    blue: "bg-blue-100 text-blue-700",
    red: "bg-red-100 text-red-700",
    green: "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-700",
    purple: "bg-purple-100 text-purple-700",
  };

  return (
    <>
      <PageHeader
        title="训练中心"
        subtitle={selectedType === "triage" ? "选择虚拟患者进行预检分诊训练，快速评估并完成分诊判定。" : selectedType ? "选择虚拟患者进行病史采集训练，系统将模拟真实护理场景。" : "选择训练类型和虚拟患者，系统将模拟真实护理场景，训练结束后自动评分。"}
        icon={ClipboardList}
        backTo="/home"
      />

      <div className="space-y-6">
        {!hintDismissed && (
          <div className="relative rounded-xl border border-transparent bg-warning p-4 sm:p-5">
            <div className="flex gap-3 items-start">
              <Lightbulb size={20} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-warning-foreground">
                <span className="font-semibold">提示：</span>
                选择一种训练类型后，系统将展示对应的虚拟患者病例。每次训练结束后，系统会根据你的表现自动评分。
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.setItem("training_hint_dismissed", "1");
                setHintDismissed(true);
              }}
              className="absolute top-2 right-2 size-8 flex items-center justify-center rounded-lg hover:bg-amber-200/50"
              aria-label="关闭提示"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Mode selection cards */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            选择训练类型
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {profiles.map((p) => {
              const Icon = TYPE_ICONS[p.icon] || Stethoscope;
              const cfg = TRAINING_TYPE_CONFIGS[p.type];
              const isSelected = selectedType === p.type;
              const count = (p as any).case_count ?? 0;
              return (
                <button
                  key={p.type}
                  type="button"
                  onClick={() => handleTypeSelect(p.type)}
                  className={cn(
                    "relative flex flex-col items-start gap-3 min-w-[200px] flex-1 rounded-xl border p-5 text-left transition-all",
                    isSelected
                      ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                      : "border-border bg-card hover:border-primary/30 hover:shadow-md",
                  )}
                >
                  {cfg && (
                    <div
                      className={cn(
                        "absolute inset-0 rounded-xl opacity-30",
                        "bg-gradient-to-br",
                        cfg.gradient,
                      )}
                    />
                  )}
                  <div
                    className={cn(
                      "relative flex size-12 items-center justify-center rounded-xl",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon size={24} />
                  </div>
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold">{p.label}</h3>
                      <Badge variant={isSelected ? "default" : "outline"}>
                        {count} 例
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                      {p.description}
                    </p>
                  </div>
                  {p.type === "history_taking" && (
                    <div className="relative flex gap-2 mt-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">问诊</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">查体</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-600">评分</span>
                    </div>
                  )}
                  {p.type === "triage" && (
                    <div className="relative flex gap-2 mt-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">快速评估</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-600">分诊</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Difficulty filter — only after type selected */}
        {selectedType && (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className={cn(
                "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                difficultyFilter === 0
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => {
                setDifficultyFilter(0);
                setOffset(0);
              }}
            >
              全部
            </button>
            {[1, 2, 3].map((d) => (
              <button
                type="button"
                key={d}
                className={cn(
                  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  difficultyFilter === d
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => {
                  setDifficultyFilter(d);
                  setOffset(0);
                }}
              >
                {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>
        )}

        {/* Case cards */}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <LoadingSkeleton key={i} variant="card" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-xl border bg-card">
            <EmptyState
              icon={AlertTriangle}
              title="加载失败"
              description="请检查网络后重试"
            />
          </div>
        ) : !selectedType ? (
          <div className="rounded-xl border bg-card">
            <EmptyState
              icon={ClipboardList}
              title="请先选择一种训练类型"
              description="选择后即可浏览对应的虚拟患者病例"
            />
          </div>
        ) : cases.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <EmptyState icon={AlertTriangle} title="暂无病例" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cases.map((c) => {
              const summary = getPatientSummary(c.patient_summary);
              const isStarting =
                startMutation.isPending && selectedCase?.id === c.id;
              const diffLabel = DIFFICULTY_LABELS[c.difficulty || 1];
              const typeLabel = getTypeLabel(c.training_type, profiles);
              const cfg = TRAINING_TYPE_CONFIGS[c.training_type];
              const colorClass = typeColorMap[cfg?.color ?? "blue"];
              return (
                <div
                  key={c.id}
                  className="group flex flex-col gap-3 rounded-xl border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold leading-snug">
                      {c.name}
                    </h3>
                    <span className="flex gap-0.5 shrink-0 mt-0.5">
                      {getDifficultyStars(c.difficulty)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        DIFFICULTY_COLORS[c.difficulty || 1] as
                          | "success"
                          | "warning"
                          | "danger"
                          | "default"
                      }
                    >
                      {diffLabel}
                    </Badge>
                    <span
                      className={cn(
                        "px-2 py-0.5 text-xs rounded",
                        colorClass,
                      )}
                    >
                      {typeLabel}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                    {c.description}
                  </p>
                  {typeof summary.gender === "string" && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <User size={14} />
                        {(() => {
                          const g =
                            summary.gender === "男"
                              ? "male"
                              : summary.gender === "女"
                                ? "female"
                                : summary.gender;
                          return g === "male"
                            ? "男性"
                            : g === "female"
                              ? "女性"
                              : g;
                        })()}
                      </span>
                      {typeof summary.age === "number" && (
                        <span>{summary.age}岁</span>
                      )}
                      {typeof summary.chief_complaint === "string" && (
                        <span className="truncate max-w-[180px]">
                          主诉：{summary.chief_complaint}
                        </span>
                      )}
                    </div>
                  )}
                  {c.training_type === "triage" && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{(c as any).arrival_mode === "ambulance" ? "🚑 救护车" : (c as any).arrival_mode === "stretcher" ? "🛏️ 平车" : "🚶 步行"}</span>
                    </div>
                  )}
                  <Button
                    className="mt-auto w-full"
                    onClick={() =>
                      setSelectedCase({
                        id: c.id,
                        name: c.name,
                        training_type: c.training_type,
                        difficulty: c.difficulty || 1,
                        description: c.description,
                        patient_summary: c.patient_summary,
                      })
                    }
                    disabled={startMutation.isPending}
                  >
                    {isStarting ? "启动中..." : "开始训练"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-xl border bg-card px-4 py-3">
          <Pagination
            total={total}
            offset={offset}
            limit={LIMIT}
            onChange={setOffset}
          />
        </div>
      </div>

      {selectedCase && (
        <TrainingConfigModal
          open={!!selectedCase}
          caseInfo={selectedCase}
          trainingType={selectedCase.training_type}
          onClose={() => setSelectedCase(null)}
          onStart={(features, timeLimit) => {
            startMutation.mutate({
              caseId: selectedCase.id,
              features,
              timeLimit,
            });
            setSelectedCase(null);
          }}
          loading={startMutation.isPending}
        />
      )}
    </>
  );
}
