import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, Lightbulb, Star, User } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCases, startTraining } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Layout from "@/components/Layout";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";

type CaseBrief = components["schemas"]["CaseBrief"];

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };
const LIMIT = 50;

interface PatientSummary {
  gender?: string;
  age?: number;
  chief_complaint?: string;
}

function getPatientSummary(ps: CaseBrief["patient_summary"]): PatientSummary {
  if (ps && typeof ps === "object") return ps as PatientSummary;
  return {};
}

export default function CaseSelect() {
  const [difficultyFilter, setDifficultyFilter] = useState(0);
  const [offset, setOffset] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();

  const { data: casesData, isLoading } = useQuery({
    queryKey: ["cases", offset],
    queryFn: () => getCases({ offset, limit: LIMIT }).then((r) => r.data),
  });

  const startMutation = useMutation({
    mutationFn: (caseId: number) => startTraining(caseId),
    onSuccess: (res) => navigate(`/training/${res.data.record_id}`),
    onError: () => toast.error("开始训练失败，请重试"),
  });

  const cases = casesData?.items ?? [];
  const total = casesData?.total ?? 0;
  const filteredCases = difficultyFilter === 0 ? cases : cases.filter((c) => (c.difficulty || 1) === difficultyFilter);

  const getDifficultyStars = (d?: number | null) => {
    const level = d && DIFFICULTY_LABELS[d] ? d : 1;
    return Array.from({ length: 3 }, (_, i) => <Star key={i} size={12} fill={i < level ? "#f59e0b" : "none"} color={i < level ? "#f59e0b" : "#d1d5db"} />);
  };

  return (
    <Layout>
      <PageHeader
        title="病例库"
        subtitle="选择一位虚拟患者开始病史采集训练。系统将模拟真实患者与你对话，训练结束后自动评分。"
        icon={ClipboardList}
        backTo="/home"
      />

      <div className="mb-6 rounded-xl border border-amber-200 p-6" style={{ background: "linear-gradient(135deg, #fef3c7, #fffbeb)" }}>
        <div className="flex gap-3 items-start">
          <Lightbulb size={24} color="#f59e0b" />
          <div className="flex-1">
            <strong>提示：</strong>每次对话结束后，系统将根据你的问诊完整度自动评分。建议针对患者的主诉展开系统性提问。
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg px-[22px] py-[9px] text-sm font-medium cursor-pointer transition-all",
              difficultyFilter === 0 ? "bg-blue-600 text-white hover:bg-blue-700" : "text-gray-700 hover:bg-gray-100",
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
                "inline-flex items-center justify-center gap-1.5 rounded-lg px-[22px] py-[9px] text-sm font-medium cursor-pointer transition-all",
                difficultyFilter === d ? "bg-blue-600 text-white hover:bg-blue-700" : "text-gray-700 hover:bg-gray-100",
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
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-muted-foreground">加载中...</div>
      ) : filteredCases.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
          <AlertTriangle size={40} className="mb-3 opacity-40" />
          <p>暂无病例</p>
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {filteredCases.map((c) => {
            const summary = getPatientSummary(c.patient_summary);
            return (
              <div
                key={c.id}
                className="bg-card border border-border rounded-xl p-6 flex flex-col gap-3 cursor-pointer transition-shadow transition-transform duration-200 hover:shadow-lg hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-semibold">{c.name}</h3>
                  <span className="flex gap-0.5">{getDifficultyStars(c.difficulty)}</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{c.description}</p>
                {typeof summary.gender === "string" && (
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <User size={14} />
                      {summary.gender === "男" ? "男性" : summary.gender === "女" ? "女性" : summary.gender}
                    </span>
                    {typeof summary.age === "number" && <span>{summary.age}岁</span>}
                    {typeof summary.chief_complaint === "string" && <span className="truncate">主诉：{summary.chief_complaint}</span>}
                  </div>
                )}
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg px-[22px] py-[9px] text-sm font-medium cursor-pointer transition-all mt-auto bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => startMutation.mutate(c.id)}
                  disabled={startMutation.isPending}
                >
                  {startMutation.isPending && startMutation.variables === c.id ? "启动中..." : "开始训练"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
    </Layout>
  );
}
