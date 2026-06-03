import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle, ChevronDown, ChevronRight, Copy, Edit3, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import {
  deleteConfig,
  deleteSecret,
  fetchConfigs,
  fetchEnvFallback,
  fetchSecrets,
  reloadRouter,
  resetConfig,
  testAllConfigs,
  testConfig,
  testEnvFallback,
  toggleConfig,
} from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ConfigModal from "./ConfigModal";
import SecretModal from "./SecretModal";

type Schemas = components["schemas"];
type ApiSecretResponse = Schemas["ApiSecretResponse"];
type LLMConfigResponse = Schemas["LLMConfigResponse"];
type TestResultItem = Schemas["TestResultItem"];

const PURPOSE_LABELS: Record<string, string> = { patient_chat: "患者对话", scoring: "评分", qa: "问答", case_generation: "病例生成", "*": "通配" };
const PROVIDER_COLORS: Record<string, string> = {
  deepseek: "var(--blue-500)",
  openai: "var(--green-500)",
  ollama: "var(--purple-500)",
  anthropic: "var(--amber-500)",
};
const PROVIDER_BG: Record<string, string> = { deepseek: "var(--blue-50)", openai: "var(--green-50)", ollama: "var(--purple-50)", anthropic: "var(--amber-50)" };

const St = {
  card: { border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", overflow: "hidden" } as React.CSSProperties,
  groupHeader: {
    padding: "var(--space-2) var(--space-4)",
    background: "var(--bg-surface-subtle)",
    borderBottom: "1px solid var(--border-color)",
    fontSize: "0.85rem",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
  } as React.CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" } as React.CSSProperties,
  th: {
    padding: "var(--space-1) var(--space-3)",
    textAlign: "left",
    color: "var(--text-secondary)",
    fontWeight: 600,
    borderBottom: "1px solid var(--border-color)",
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  } as React.CSSProperties,
  td: { padding: "var(--space-1) var(--space-3)", borderBottom: "1px solid var(--border-color)" } as React.CSSProperties,
  primaryBtn: {
    padding: "var(--space-1) var(--space-3)",
    border: "none",
    borderRadius: "var(--radius-md)",
    background: "var(--color-primary)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "0.82rem",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-1)",
  } as React.CSSProperties,
  btnSm: {
    padding: "var(--space-1) var(--space-2)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-md)",
    background: "#fff",
    cursor: "pointer",
    fontSize: "0.75rem",
    display: "flex",
    alignItems: "center",
    gap: 3,
  } as React.CSSProperties,
};

const statusDot = (status: string) => {
  const map: Record<string, string> = { active: "var(--green-500)", degraded: "var(--amber-500)", disabled: "var(--red-400)" };
  return { width: 6, height: 6, borderRadius: "50%", background: map[status] || "var(--text-tertiary)", display: "inline-block", marginRight: 4 };
};

const providerTag = (p: string): React.CSSProperties => ({
  padding: "0 6px",
  borderRadius: "var(--radius-full)",
  fontSize: "0.65rem",
  fontWeight: 600,
  lineHeight: "18px",
  background: PROVIDER_BG[p] || "var(--bg-surface-subtle)",
  color: PROVIDER_COLORS[p] || "var(--text-secondary)",
});

export default function ApiManagementTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [editingSecret, setEditingSecret] = useState<ApiSecretResponse | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LLMConfigResponse | null>(null);
  const [prefilledConfig, setPrefilledConfig] = useState<{ secret_id: number; model: string } | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [testResults, setTestResults] = useState<TestResultItem[] | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  const { data: secrets = [] } = useQuery({ queryKey: ["apiSecrets"], queryFn: () => fetchSecrets().then((r) => r.data) });
  const { data: configs = [], isLoading: configsLoading } = useQuery({ queryKey: ["apiConfigs"], queryFn: () => fetchConfigs(undefined).then((r) => r.data) });
  const { data: envFallback } = useQuery({ queryKey: ["apiFallback"], queryFn: () => fetchEnvFallback().then((r) => r.data) });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["apiSecrets"] });
    void queryClient.invalidateQueries({ queryKey: ["apiConfigs"] });
  };

  const handleDeleteSecret = async (s: ApiSecretResponse) => {
    if (s.config_count > 0) return toast.error(`"${s.label}" 关联了 ${s.config_count} 个配置，请先删除配置`);
    if (!(await confirm({ title: "删除密钥", message: `删除 "${s.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteSecret(s.id);
      toast.success("已删除");
      invalidateAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "删除失败");
    }
  };
  const handleDeleteConfig = async (c: LLMConfigResponse) => {
    if (!(await confirm({ title: "删除配置", message: `删除 "${c.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteConfig(c.id);
      toast.success("已删除");
      invalidateAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "删除失败");
    }
  };
  const handleToggle = async (c: LLMConfigResponse) => {
    const action = c.status === "active" ? "停用" : "启用";
    if (!(await confirm({ title: action, message: `${action} "${c.label}"？`, confirmText: action }))) return;
    try {
      await toggleConfig(c.id);
      invalidateAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "操作失败");
    }
  };
  const handleReset = async (c: LLMConfigResponse) => {
    try {
      await resetConfig(c.id);
      toast.success("已恢复");
      invalidateAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "恢复失败");
    }
  };
  const handleTest = async (c: LLMConfigResponse) => {
    try {
      const { data } = await testConfig(c.id);
      data.ok ? toast.success(`${c.label} · ${data.latency_ms}ms`) : toast.error(data.error || "连接失败");
    } catch {
      toast.error("测试请求失败");
    }
  };
  const handleTestAll = async () => {
    setTestingAll(true);
    setTestResults(null);
    try {
      const { data } = await testAllConfigs();
      setTestResults(data.results);
      toast.success(`${data.results.filter((r) => r.ok).length}/${data.results.length} 连通`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "检查失败");
    } finally {
      setTestingAll(false);
    }
  };
  const handleTestFallback = async () => {
    try {
      const { data } = await testEnvFallback();
      data.ok ? toast.success(`环境密钥 · ${data.latency_ms}ms`) : toast.error(data.error || "连通失败");
      queryClient.invalidateQueries({ queryKey: ["apiFallback"] });
    } catch {
      toast.error("测试请求失败");
    }
  };

  const ALL_PURPOSES = ["patient_chat", "scoring", "qa", "case_generation"];
  const wildcardConfigs = configs.filter((c) => c.purpose === "*");
  const groupedConfigs: Record<string, LLMConfigResponse[]> = {};
  configs.forEach((c) => {
    if (c.purpose === "*") return;
    if (!groupedConfigs[c.purpose]) groupedConfigs[c.purpose] = [];
    groupedConfigs[c.purpose].push(c);
  });

  return (
    <>
      {/* Env fallback — compact collapsible */}
      <div style={{ marginBottom: "var(--space-3)" }}>
        <button
          onClick={() => setShowFallback((v) => !v)}
          style={{ ...St.btnSm, background: "none", border: "none", padding: 0, fontSize: "0.78rem", color: "var(--text-tertiary)", cursor: "pointer" }}
        >
          {showFallback ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 环境兜底
          {envFallback && <span style={{ ...statusDot(envFallback.available ? "active" : "disabled") }} />}
          <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", fontFamily: "monospace" }}>sk-...{envFallback?.key_suffix || "****"}</span>
        </button>
        {showFallback && (
          <div
            className="card"
            style={{
              marginTop: "var(--space-1)",
              padding: "var(--space-1) var(--space-3)",
              background: "var(--bg-surface-subtle)",
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              flexWrap: "wrap",
            }}
          >
            {envFallback ? (
              <>
                <span>
                  {envFallback.model_flash} / {envFallback.model_pro} @ {envFallback.base_url}
                </span>
                {envFallback.latency_ms != null && <span>{envFallback.latency_ms}ms</span>}
                {envFallback.error && <span style={{ color: "var(--red-500)" }}>{envFallback.error}</span>}
                <button onClick={handleTestFallback} style={{ ...St.btnSm, fontSize: "0.7rem" }}>
                  <Activity size={10} /> 测试
                </button>
              </>
            ) : (
              <span>加载中...</span>
            )}
          </div>
        )}
      </div>

      {/* Key cards */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, margin: 0 }}>API 密钥</h3>
          <button
            onClick={() => {
              setEditingSecret(null);
              setShowSecretModal(true);
            }}
            style={St.primaryBtn}
          >
            <Plus size={14} /> 添加密钥
          </button>
        </div>
        {secrets.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "0.85rem" }}>
            暂无密钥 · 请先添加 API Key 才能创建用途配置
          </div>
        ) : (
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {secrets.map((s) => {
              const p = (s as any).provider || "";
              return (
                <div key={s.id} className="card" style={{ flex: "1 1 200px", maxWidth: 280, padding: "var(--space-2) var(--space-3)", position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", marginBottom: 2 }}>
                    <span style={providerTag(p)}>{p || "custom"}</span>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>sk-...{s.key_suffix}</div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", marginTop: 2 }}>
                    {s.config_count} 配置 · 本月 ¥{Number(s.monthly_cost_used || 0).toFixed(2)}
                  </div>
                  <div style={{ position: "absolute", top: "var(--space-1)", right: "var(--space-1)", display: "flex", gap: 2 }}>
                    <button
                      onClick={() => {
                        setEditingSecret(s);
                        setShowSecretModal(true);
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 2 }}
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      onClick={() => handleDeleteSecret(s)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red-400)", padding: 2 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Configs */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "var(--space-2)",
            flexWrap: "wrap",
            gap: "var(--space-2)",
          }}
        >
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, margin: 0 }}>用途配置</h3>
          <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
            <button onClick={handleTestAll} disabled={testingAll} style={{ ...St.btnSm, opacity: testingAll ? 0.5 : 1 }}>
              <Activity size={12} /> {testingAll ? "检查中..." : "检查"}
            </button>
            <button
              onClick={() =>
                reloadRouter()
                  .then(() => toast.success("路由已重载"))
                  .catch(() => toast.error("重载失败"))
              }
              style={St.btnSm}
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={() => {
                setEditingConfig(null);
                setShowConfigModal(true);
              }}
              style={St.primaryBtn}
            >
              <Plus size={14} /> 添加配置
            </button>
          </div>
        </div>
        {testResults && (
          <div
            style={{
              padding: "var(--space-1) var(--space-2)",
              marginBottom: "var(--space-2)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.78rem",
              background: testResults.every((r) => r.ok) ? "var(--green-50)" : "var(--amber-50)",
              border: `1px solid ${testResults.every((r) => r.ok) ? "var(--green-200)" : "var(--amber-200)"}`,
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              flexWrap: "wrap",
            }}
          >
            {testResults.map((r, idx) => (
              <span
                key={r.base_url || idx}
                style={{ display: "inline-flex", alignItems: "center", gap: 3, color: r.ok ? "var(--green-700)" : "var(--red-600)" }}
              >
                {r.ok ? "✓" : "✗"} {r.base_url} {r.latency_ms != null && <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>{r.latency_ms}ms</span>}
              </span>
            ))}
          </div>
        )}
        {configsLoading ? (
          <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>Loading...</div>
        ) : configs.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>
            暂无用途配置 · 点击"添加配置"开始
          </div>
        ) : (
          ALL_PURPOSES.map((purpose) => {
            const dedicated = (groupedConfigs[purpose] || []).sort((a, b) => (a.priority || 0) - (b.priority || 0));
            if (dedicated.length === 0 && wildcardConfigs.length === 0) return null;
            const wildcards = wildcardConfigs.map((c) => ({ ...c, _wildcard: true as const }));
            const group = [...dedicated, ...wildcards].sort((a, b) => (a.priority || 0) - (b.priority || 0));
            const firstActive = group.find((c) => c.status === "active");
            return (
              <div key={purpose} style={{ ...St.card, marginBottom: "var(--space-3)" }}>
                <div style={St.groupHeader}>
                  <span>{PURPOSE_LABELS[purpose] || purpose}</span>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", fontWeight: 400 }}>{purpose}</span>
                  {firstActive && (
                    <span style={{ fontSize: "0.72rem", color: "var(--green-600)", fontWeight: 400, marginLeft: "auto" }}>
                      → {(firstActive as any)._wildcard ? "(通配)" : ""}
                      {firstActive.label || firstActive.model}
                    </span>
                  )}
                  {!firstActive && dedicated.length > 0 && (
                    <span style={{ fontSize: "0.72rem", color: "var(--red-500)", fontWeight: 400, marginLeft: "auto" }}>无可用路由</span>
                  )}
                </div>
                <table style={St.table}>
                  <thead>
                    <tr>
                      <th style={St.th}></th>
                      <th style={St.th}>模型 &amp; 来源</th>
                      <th style={St.th}>状态</th>
                      <th style={St.th}>今日</th>
                      <th style={St.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((c, idx) => {
                      const isActive = idx === 0 && c.status === "active";
                      const isWildcard = "_wildcard" in c && c._wildcard;
                      const provider = (c as any).provider || "";
                      return (
                        <tr
                          key={c.id}
                          style={{
                            ...(isActive ? { background: "var(--green-50)", borderLeft: "3px solid var(--green-500)" } : {}),
                            ...(isWildcard ? { opacity: 0.55, fontSize: "0.8rem" } : {}),
                          }}
                        >
                          <td style={{ ...St.td, width: 28, color: "var(--text-tertiary)", textAlign: "center" }}>{isWildcard ? "通" : c.priority}</td>
                          <td style={St.td}>
                            <span style={{ ...providerTag(provider), marginRight: 6 }}>{provider}</span>
                            <span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{c.model}</span>
                            <div style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", marginTop: 1 }}>{c.secret_label}</div>
                          </td>
                          <td style={St.td}>
                            <span style={{ display: "inline-flex", alignItems: "center", fontSize: "0.8rem" }}>
                              <span style={statusDot(c.status)} />
                              {c.status === "active" ? "正常" : c.status === "degraded" ? "熔断" : "关闭"}
                            </span>
                          </td>
                          <td style={{ ...St.td, fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                            {c.call_count_today ? `${c.call_count_today} 次` : "-"}
                            {c.total_cost_today ? <span style={{ marginLeft: 4, fontSize: "0.7rem" }}>¥{Number(c.total_cost_today).toFixed(3)}</span> : ""}
                          </td>
                          <td style={St.td}>
                            <div style={{ display: "flex", gap: 2 }}>
                              <button
                                onClick={() => {
                                  setEditingConfig(c);
                                  setShowConfigModal(true);
                                }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-primary)", padding: 2 }}
                              >
                                <Edit3 size={12} />
                              </button>
                              <button
                                onClick={() => {
                                  setPrefilledConfig({ secret_id: c.secret_id, model: c.model });
                                  setEditingConfig(null);
                                  setShowConfigModal(true);
                                }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 2 }}
                                title="复制为新配置"
                              >
                                <Copy size={12} />
                              </button>
                              {c.status === "degraded" ? (
                                <button
                                  onClick={() => handleReset(c)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--amber-500)", padding: 2 }}
                                  title="手动恢复"
                                >
                                  <RefreshCw size={12} />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleToggle(c)}
                                  title={c.status === "active" ? "停用" : "启用"}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    color: c.status === "active" ? "var(--red-400)" : "var(--green-500)",
                                    padding: 2,
                                  }}
                                >
                                  {c.status === "active" ? <XCircle size={12} /> : <CheckCircle size={12} />}
                                </button>
                              )}
                              <button
                                onClick={() => handleTest(c)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 2 }}
                                title="测试连接"
                              >
                                <Activity size={12} />
                              </button>
                              <button
                                onClick={() => handleDeleteConfig(c)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red-400)", padding: 2 }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </div>

      <SecretModal
        open={showSecretModal}
        secret={editingSecret}
        onClose={() => {
          setShowSecretModal(false);
          setEditingSecret(null);
        }}
        onSaved={invalidateAll}
      />
      <ConfigModal
        open={showConfigModal}
        configData={editingConfig}
        prefilled={prefilledConfig}
        onClose={() => {
          setShowConfigModal(false);
          setEditingConfig(null);
          setPrefilledConfig(null);
        }}
        onSaved={invalidateAll}
      />
    </>
  );
}
