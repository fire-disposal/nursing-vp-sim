import { AlertTriangle, ClipboardList, Lightbulb, Star, User } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getCases, startTraining } from "@/api/api-client";
import Layout from "@/components/Layout";
import Pagination from "@/components/ui/Pagination";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/ui/PageHeader";
import type { components } from "@/api/api-types.gen";

type CaseBrief = components["schemas"]["CaseBrief"];

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };
const LIMIT = 50;

function getPatientSummary(ps: unknown) {
  if (ps && typeof ps === "object") return ps as Record<string, unknown>;
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
    return Array.from({ length: 3 }, (_, i) => (
      <Star key={i} size={12} fill={i < level ? "#f59e0b" : "none"} color={i < level ? "#f59e0b" : "#d1d5db"} />
    ));
  };

  return (
    <Layout>
      <PageHeader
        title="病例库"
        subtitle="选择一位虚拟患者开始病史采集训练。系统将模拟真实患者与你对话，训练结束后自动评分。"
        icon={ClipboardList}
        backTo="/home"
      />

      <div className="card" style={{ marginBottom: 24, background: "linear-gradient(135deg, #fef3c7, #fffbeb)", border: "1px solid #fde68a" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Lightbulb size={24} color="#f59e0b" />
          <div style={{ flex: 1 }}>
            <strong>提示：</strong>每次对话结束后，系统将根据你的问诊完整度自动评分。建议针对患者的主诉展开系统性提问。
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className={`btn ${difficultyFilter === 0 ? "btn-primary" : ""}`} onClick={() => { setDifficultyFilter(0); setOffset(0); }}>
            全部
          </button>
          {[1, 2, 3].map((d) => (
            <button
              type="button"
              key={d}
              className={`btn ${difficultyFilter === d ? "btn-primary" : ""}`}
              onClick={() => { setDifficultyFilter(d); setOffset(0); }}
            >
              {DIFFICULTY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>加载中...</div>
      ) : filteredCases.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
          <AlertTriangle size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p>暂无病例</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {filteredCases.map((c) => {
            const summary = getPatientSummary((c as Record<string, unknown>).patient_summary);
            return (
              <div
                key={c.id}
                className="card"
                style={{
                  cursor: "pointer",
                  transition: "box-shadow 0.2s, transform 0.2s",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-lg)";
                  (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-sm)";
                  (e.currentTarget as HTMLElement).style.transform = "none";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <h3 style={{ fontSize: "1.05rem", fontWeight: 600, margin: 0 }}>{c.name}</h3>
                  <span style={{ display: "flex", gap: 2 }}>{getDifficultyStars(c.difficulty)}</span>
                </div>
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
                  {c.description}
                </p>
                {typeof summary.gender === "string" && (
                  <div style={{ display: "flex", gap: 16, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <User size={14} />
                      {summary.gender === "男" ? "男性" : summary.gender === "女" ? "女性" : summary.gender}
                    </span>
                    {typeof summary.age === "number" && <span>{summary.age}岁</span>}
                    {typeof summary.chief_complaint === "string" && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>主诉：{summary.chief_complaint}</span>}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: "auto" }}
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
