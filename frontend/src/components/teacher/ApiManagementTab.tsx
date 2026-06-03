import { Activity, CheckCircle, Edit3, Plus, RefreshCw, Server, Shield, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkHealth,
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
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ConfigModal from "./ConfigModal";
import SecretModal from "./SecretModal";
import type { components } from "@/api/api-types.gen";

type Schemas = components["schemas"];
type ApiSecretResponse = Schemas["ApiSecretResponse"];
type LLMConfigResponse = Schemas["LLMConfigResponse"];
type TestResultItem = Schemas["TestResultItem"];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  active: { bg: "var(--green-100)", color: "var(--green-700)" },
  degraded: { bg: "var(--amber-100)", color: "var(--amber-700)" },
  disabled: { bg: "var(--red-100)", color: "var(--red-700)" },
};
const STATUS_LABELS: Record<string, string> = { active: "正常", degraded: "熔断", disabled: "手动关闭" };
const PURPOSE_LABELS: Record<string, string> = { patient_chat: "患者对话", scoring: "评分", qa: "问答", case_generation: "病例生成", "*": "通配" };
const PROVIDER_COLORS: Record<string, string> = {
  deepseek: "var(--blue-500)",
  openai: "var(--green-500)",
  ollama: "var(--purple-500)",
  anthropic: "var(--amber-500)",
};
const PROVIDER_BG: Record<string, string> = {
  deepseek: "var(--blue-50)",
  openai: "var(--green-50)",
  ollama: "var(--purple-50)",
  anthropic: "var(--amber-50)",
};

const S: Record<string, React.CSSProperties> = {
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" },
  th: {
    padding: "var(--space-2) var(--space-3)",
    textAlign: "left",
    color: "var(--text-secondary)",
    fontWeight: 600,
    borderBottom: "2px solid var(--border-color)",
    fontSize: "0.75rem",
    textTransform: "uppercase",
  },
  td: { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color)" },
  primaryBtn: {
    padding: "var(--space-2) var(--space-4)",
    border: "none",
    borderRadius: "var(--radius-md)",
    background: "var(--color-primary)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "0.85rem",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-1)",
  },
};

const Sbadge = (bg: string, c: string): React.CSSProperties => ({
  padding: "2px 8px",
  borderRadius: "var(--radius-full)",
  fontSize: "0.75rem",
  background: bg,
  color: c,
});

export default function ApiManagementTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [editingSecret, setEditingSecret] = useState<ApiSecretResponse | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LLMConfigResponse | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [testResults, setTestResults] = useState<TestResultItem[] | null>(null);
  const [testingFallback, setTestingFallback] = useState(false);
  const [showHealth, setShowHealth] = useState(false);

  const { data: secrets = [] } = useQuery({
    queryKey: ["apiSecrets"],
    queryFn: () => fetchSecrets().then((r) => r.data),
  });
  const { data: configs = [], isLoading: configsLoading } = useQuery({
    queryKey: ["apiConfigs"],
    queryFn: () => fetchConfigs(undefined).then((r) => r.data),
  });
  const { data: health = [] } = useQuery({
    queryKey: ["apiHealth"],
    queryFn: () => checkHealth().then((r) => r.data),
    enabled: showHealth,
  });
  const { data: envFallback } = useQuery({
    queryKey: ["apiFallback"],
    queryFn: () => fetchEnvFallback().then((r) => r.data),
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["apiSecrets"] });
    void queryClient.invalidateQueries({ queryKey: ["apiConfigs"] });
  };

  const handleTestFallback = async () => {
    setTestingFallback(true);
    try {
      const { data } = await testEnvFallback();
      if (data.ok) toast.success(`环境密钥连通正常 · ${data.latency_ms}ms`);
      else toast.error(data.error || "连通失败");
      queryClient.invalidateQueries({ queryKey: ["apiFallback"] });
    } catch {
      toast.error("测试请求失败");
    } finally {
      setTestingFallback(false);
    }
  };

  const handleDeleteSecret = async (s: ApiSecretResponse) => {
    if (s.config_count > 0) {
      toast.error(`该密钥关联了 ${s.config_count} 个配置，请先删除配置`);
      return;
    }
    if (!(await confirm({ title: "删除密钥", message: `删除 "${s.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteSecret(s.id);
      toast.success("密钥已删除");
      invalidateAll();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "删除失败");
    }
  };

  const handleDeleteConfig = async (c: LLMConfigResponse) => {
    if (!(await confirm({ title: "删除配置", message: `删除 "${c.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteConfig(c.id);
      toast.success("配置已删除");
      invalidateAll();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "删除失败");
    }
  };

  const handleToggle = async (c: LLMConfigResponse) => {
    if (
      !(await confirm({
        title: c.status === "active" ? "停用" : "启用",
        message: `${c.status === "active" ? "停用" : "启用"} "${c.label}"？`,
        confirmText: c.status === "active" ? "停用" : "启用",
      }))
    )
      return;
    try {
      await toggleConfig(c.id);
      invalidateAll();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "操作失败");
    }
  };

  const handleReset = async (c: LLMConfigResponse) => {
    try {
      await resetConfig(c.id);
      toast.success("已恢复");
      invalidateAll();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "恢复失败");
    }
  };

  const handleTest = async (c: LLMConfigResponse) => {
    try {
      const { data } = await testConfig(c.id);
      if (data.ok) toast.success(`${c.label} 连接正常 · ${data.latency_ms}ms`);
      else toast.error(data.error || "连接失败");
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
      const ok = data.results.filter((r) => r.ok).length;
      toast.success(`${ok}/${data.results.length} 个配置连通正常`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "检查失败");
    } finally {
      setTestingAll(false);
    }
  };

  const ALL_PURPOSES = ["patient_chat", "scoring", "qa", "case_generation"];
  const wildcardConfigs = configs.filter((c) => c.purpose === "*");
  const groupedConfigs: Record<string, LLMConfigResponse[]> = {};
  configs.forEach((c) => {
    if (c.purpose === "*") return;
    const p = c.purpose;
    if (!groupedConfigs[p]) groupedConfigs[p] = [];
    groupedConfigs[p].push(c);
  });

  const getProviderStyle = (provider: string) => {
    const color = PROVIDER_COLORS[provider] || "var(--text-tertiary)";
    const bg = PROVIDER_BG[provider] || "var(--bg-surface-subtle)";
    return { color, bg };
  };

  return (
    <>
      {/* Env fallback banner */}
      <div
        className="card"
        style={{
          marginBottom: "var(--space-4)",
          border: envFallback?.available ? "1px solid var(--amber-300)" : "1px solid var(--red-300)",
          background: envFallback?.available ? "var(--amber-50)" : "var(--red-50)",
          padding: "var(--space-2) var(--space-4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Shield size={18} style={{ color: envFallback?.available ? "var(--amber-600)" : "var(--red-500)" }} />
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>环境兜底</span>
            <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>最后防线 · 只读</span>
            {envFallback ? (
              <span
                style={{
                  padding: "1px 8px",
                  borderRadius: "var(--radius-full)",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  background: envFallback.available ? "var(--green-100)" : "var(--red-100)",
                  color: envFallback.available ? "var(--green-700)" : "var(--red-700)",
                }}
              >
                {envFallback.available ? "可用" : "不可用"}
              </span>
            ) : (
              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>加载中...</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {envFallback && (
              <>
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  {envFallback.model_flash} / {envFallback.model_pro} @ {envFallback.base_url}
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", fontFamily: "monospace" }}>sk-...{envFallback.key_suffix}</span>
              </>
            )}
            <button
              onClick={handleTestFallback}
              disabled={testingFallback}
              style={{
                padding: "var(--space-1) var(--space-3)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                background: testingFallback ? "var(--text-tertiary)" : "#fff",
                cursor: "pointer",
                fontSize: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Activity size={12} />
              {testingFallback ? "测试中..." : "测试连通"}
            </button>
          </div>
        </div>
      </div>

      {/* Key cards row */}
      <div style={{ marginBottom: "var(--space-5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0 }}>API 密钥</h3>
          <button
            onClick={() => {
              setEditingSecret(null);
              setShowSecretModal(true);
            }}
            style={S.primaryBtn}
          >
            <Plus size={14} /> 添加密钥
          </button>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {secrets.length === 0 ? (
            <div style={{ width: "100%", textAlign: "center", padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "0.85rem" }}>
              暂无密钥凭证
            </div>
          ) : (
            secrets.map((s) => {
              const pStyle = getProviderStyle((s as any).provider || "");
              return (
                <div key={s.id} className="card" style={{ flex: "1 1 260px", maxWidth: 360, padding: "var(--space-3) var(--space-4)", position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        background: pStyle.bg,
                        color: pStyle.color,
                      }}
                    >
                      {(s as any).provider || "custom"}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontFamily: "monospace", marginBottom: "var(--space-1)" }}>
                    sk-...{s.key_suffix}
                    {(s as any).base_url && <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-tertiary)" }}>{(s as any).base_url}</span>}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    {s.config_count} 个配置 · 今日 ¥{Number(s.total_cost_today || 0).toFixed(4)} · 本月 ¥{Number(s.monthly_cost_used || 0).toFixed(2)}
                  </div>
                  <div style={{ position: "absolute", top: "var(--space-2)", right: "var(--space-2)", display: "flex", gap: 4 }}>
                    <button
                      onClick={() => {
                        setEditingSecret(s);
                        setShowSecretModal(true);
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-primary)", padding: 4 }}
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      onClick={() => handleDeleteSecret(s)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red-400)", padding: 4 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Configs + actions */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "var(--space-3)",
            flexWrap: "wrap",
            gap: "var(--space-2)",
          }}
        >
          <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0 }}>用途配置</h3>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button
              onClick={handleTestAll}
              disabled={testingAll}
              style={{ ...S.primaryBtn, background: testingAll ? "var(--text-tertiary)" : "var(--color-primary)" }}
            >
              <Activity size={14} /> {testingAll ? "检查中..." : "一键检查存活"}
            </button>
            <button
              onClick={() => {
                setShowHealth((v) => !v);
                if (!showHealth) queryClient.invalidateQueries({ queryKey: ["apiHealth"] });
              }}
              className="btn btn-secondary"
              style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-1)" }}
            >
              <Server size={14} /> 连通性
            </button>
            <button
              onClick={() =>
                reloadRouter()
                  .then(() => toast.success("路由已重载"))
                  .catch(() => toast.error("重载失败"))
              }
              className="btn btn-secondary"
              style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-1)" }}
            >
              <RefreshCw size={14} /> 重载
            </button>
            <button
              onClick={() => {
                setEditingConfig(null);
                setShowConfigModal(true);
              }}
              style={S.primaryBtn}
            >
              <Plus size={14} /> 添加配置
            </button>
          </div>
        </div>

        {/* Test results + health */}
        {testResults && (
          <div
            style={{
              padding: "var(--space-2) var(--space-3)",
              marginBottom: "var(--space-3)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.82rem",
              background: testResults.every((r) => r.ok) ? "var(--green-50)" : "var(--amber-50)",
              border: `1px solid ${testResults.every((r) => r.ok) ? "var(--green-200)" : "var(--amber-200)"}`,
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              flexWrap: "wrap",
            }}
          >
            {testResults.every((r) => r.ok) ? (
              <CheckCircle size={14} style={{ color: "var(--green-600)" }} />
            ) : (
              <XCircle size={14} style={{ color: "var(--amber-600)" }} />
            )}
            {testResults.map((r, idx) => (
              <span
                key={r.base_url || idx}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "1px 6px",
                  borderRadius: "var(--radius-sm)",
                  background: r.ok ? "" : "var(--red-50)",
                  color: r.ok ? "var(--green-700)" : "var(--red-600)",
                }}
              >
                {r.ok ? "✓" : "✗"} {r.base_url}
                {r.latency_ms != null && <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>{r.latency_ms}ms</span>}
              </span>
            ))}
          </div>
        )}
        {showHealth && health.length > 0 && (
          <div className="card" style={{ marginBottom: "var(--space-3)", padding: "var(--space-3)", overflow: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>端点</th>
                  <th style={S.th}>状态</th>
                  <th style={S.th}>延迟</th>
                </tr>
              </thead>
              <tbody>
                {health.map((h, i) => (
                  <tr key={i}>
                    <td style={S.td}>{h.base_url}</td>
                    <td style={S.td}>
                      <span
                        style={Sbadge(h.status === "ok" ? "var(--green-100)" : "var(--red-100)", h.status === "ok" ? "var(--green-700)" : "var(--red-700)")}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td style={S.td}>{h.latency_ms != null ? `${h.latency_ms}ms` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Config groups by purpose */}
        {configsLoading ? (
          <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>Loading...</div>
        ) : configs.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>
            暂无配置
          </div>
        ) : (
          ALL_PURPOSES.map((purpose) => {
            const dedicated = (groupedConfigs[purpose] || []).sort((a, b) => (a.priority || 0) - (b.priority || 0));
            const wildcards = wildcardConfigs.map((c) => ({ ...c, _wildcard: true as const })) as (LLMConfigResponse & { _wildcard: true })[];
            const group: (LLMConfigResponse & { _wildcard?: boolean })[] = [...dedicated, ...wildcards];
            return (
              <div
                key={purpose}
                style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)", overflow: "hidden" }}
              >
                <div
                  style={{
                    padding: "var(--space-3) var(--space-4)",
                    background: "var(--bg-surface-subtle)",
                    borderBottom: "1px solid var(--border-color)",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                  }}
                >
                  {PURPOSE_LABELS[purpose] || purpose} ({dedicated.length} 专用{wildcards.length > 0 ? ` + ${wildcards.length} 通配` : ""}){(() => {
                    const sorted = [...group].sort((a, b) => (a.priority || 0) - (b.priority || 0));
                    const active = sorted.find((c) => c.status === "active");
                    if (!active) {
                      const degraded = sorted.find((c) => c.status === "degraded");
                      if (degraded) return <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "var(--amber-600)", fontWeight: 400 }}>(全部熔断中)</span>;
                      return <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "var(--red-500)", fontWeight: 400 }}>(无可用路由)</span>;
                    }
                    return (
                      <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "var(--green-600)", fontWeight: 400 }}>→ {active.label || active.model}</span>
                    );
                  })()}
                </div>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>优先级</th>
                      <th style={S.th}>标签</th>
                      <th style={S.th}>密钥</th>
                      <th style={S.th}>模型</th>
                      <th style={S.th}>权重</th>
                      <th style={S.th}>状态</th>
                      <th style={S.th}>调用</th>
                      <th style={S.th}>费用</th>
                      <th style={S.th}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group
                      .sort((a, b) => (a.priority || 0) - (b.priority || 0))
                      .map((c, idx) => {
                        const sc = STATUS_COLORS[c.status] || STATUS_COLORS.disabled;
                        const displayStatus = c.status === "degraded" ? `熔断·${c.degraded_reason || "unknown"}` : STATUS_LABELS[c.status];
                        const isActiveRoute = idx === 0 && c.status === "active";
                        const isWildcard = "_wildcard" in c && c._wildcard;
                        const pStyle = getProviderStyle((c as any).provider || "");
                        return (
                          <tr
                            key={c.id}
                            style={{
                              ...(isActiveRoute ? { borderLeft: "3px solid var(--green-500)" } : {}),
                              ...(isWildcard ? { opacity: 0.6, background: "var(--bg-surface-subtle)" } : {}),
                            }}
                          >
                            <td style={S.td}>
                              {isWildcard && <span style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", marginRight: 4 }}>通配</span>}
                              {c.priority}
                            </td>
                            <td style={S.td}>{c.label}</td>
                            <td style={S.td}>
                              <span
                                style={{
                                  padding: "1px 6px",
                                  borderRadius: "var(--radius-full)",
                                  fontSize: "0.7rem",
                                  background: pStyle.bg,
                                  color: pStyle.color,
                                  marginRight: 4,
                                }}
                              >
                                {(c as any).provider || ""}
                              </span>
                              {c.secret_label}
                            </td>
                            <td style={{ ...S.td, fontFamily: "monospace", fontSize: "0.8rem" }}>{c.model}</td>
                            <td style={S.td}>{(c as any).weight || 1}</td>
                            <td style={S.td}>
                              <span style={Sbadge(sc.bg, sc.color)}>{displayStatus}</span>
                            </td>
                            <td style={S.td}>{c.call_count_today ?? "-"}</td>
                            <td style={S.td}>{c.total_cost_today != null ? `¥${Number(c.total_cost_today).toFixed(4)}` : "-"}</td>
                            <td style={S.td}>
                              <button
                                onClick={() => {
                                  setEditingConfig(c);
                                  setShowConfigModal(true);
                                }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-primary)", padding: "2px 6px" }}
                              >
                                <Edit3 size={12} />
                              </button>
                              <button
                                onClick={() => handleToggle(c)}
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: "var(--radius-full)",
                                  fontSize: "0.7rem",
                                  fontWeight: 600,
                                  border: c.status === "active" ? "1px solid var(--red-300)" : "1px solid var(--green-300)",
                                  background: c.status === "active" ? "var(--red-50)" : "var(--green-50)",
                                  color: c.status === "active" ? "var(--red-600)" : "var(--green-600)",
                                  cursor: "pointer",
                                  margin: "0 2px",
                                }}
                              >
                                {c.status === "active" ? "停用" : "启用"}
                              </button>
                              {c.status === "degraded" && (
                                <button
                                  onClick={() => handleReset(c)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--amber-500)", padding: "2px 6px" }}
                                >
                                  <RefreshCw size={12} />
                                </button>
                              )}
                              <button
                                onClick={() => handleTest(c)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-primary)", padding: "2px 6px" }}
                              >
                                <Activity size={12} />
                              </button>
                              <button
                                onClick={() => handleDeleteConfig(c)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red-400)", padding: "2px 6px" }}
                              >
                                <Trash2 size={12} />
                              </button>
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
        onClose={() => {
          setShowConfigModal(false);
          setEditingConfig(null);
        }}
        onSaved={invalidateAll}
      />
    </>
  );
}
