import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronRight, Copy, Edit3, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
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

const PURPOSE_LABELS: Record<string, string> = { patient_chat: "患者对话", scoring: "评分", qa: "问答", case_generation: "病例生成", "*": "通配兜底" };
const PROVIDER_COLORS: Record<string, string> = { deepseek: "#4f6ef7", openai: "#10a37f", ollama: "#8b5cf6", anthropic: "#d97706" };

const statusDot = (s: string) => ({
  width: 7,
  height: 7,
  borderRadius: "50%",
  display: "inline-block",
  flexShrink: 0,
  background: { active: "var(--green-500)", degraded: "var(--amber-500)", disabled: "var(--red-400)" }[s] || "var(--text-tertiary)",
});
const statusLabel = (s: string) => ({ active: "正常", degraded: "熔断", disabled: "关闭" })[s] || s;
const providerTag = (p: string) => ({
  display: "inline-block",
  padding: "0 6px",
  borderRadius: "var(--radius-full)",
  fontSize: "0.65rem",
  fontWeight: 600,
  lineHeight: "18px",
  background: `${PROVIDER_COLORS[p] || "var(--text-tertiary)"}18`,
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
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<Schemas["TestResultItem"][] | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  const { data: secrets = [] } = useQuery({ queryKey: ["apiSecrets"], queryFn: () => fetchSecrets().then((r) => r.data) });
  const { data: configs = [], isLoading } = useQuery({ queryKey: ["apiConfigs"], queryFn: () => fetchConfigs(undefined).then((r) => r.data) });
  const { data: envFallback } = useQuery({ queryKey: ["apiFallback"], queryFn: () => fetchEnvFallback().then((r) => r.data) });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["apiSecrets"] });
    void queryClient.invalidateQueries({ queryKey: ["apiConfigs"] });
  };

  const handleDeleteSecret = async (s: ApiSecretResponse) => {
    if (s.config_count > 0) return toast.error(`"${s.label}" 还关联 ${s.config_count} 个用途，先解绑`);
    if (!(await confirm({ title: "删除密钥", message: `删除 "${s.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteSecret(s.id);
      toast.success("已删除");
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "失败");
    }
  };
  const handleDeleteConfig = async (c: LLMConfigResponse) => {
    if (!(await confirm({ title: "移除绑定", message: `${PURPOSE_LABELS[c.purpose]}不再使用 ${c.model}？`, confirmText: "移除", danger: true }))) return;
    try {
      await deleteConfig(c.id);
      toast.success("已移除");
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "失败");
    }
  };
  const handleToggle = async (c: LLMConfigResponse) => {
    const action = c.status === "active" ? "停用" : "启用";
    if (!(await confirm({ title: action, message: `${action} ${PURPOSE_LABELS[c.purpose]} 的 ${c.model}？`, confirmText: action }))) return;
    try {
      await toggleConfig(c.id);
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "失败");
    }
  };
  const handleReset = async (c: LLMConfigResponse) => {
    try {
      await resetConfig(c.id);
      toast.success("已恢复");
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "失败");
    }
  };
  const handleTest = async (c: LLMConfigResponse) => {
    try {
      const r = await testConfig(c.id);
      r.data.ok ? toast.success(`${c.model} · ${r.data.latency_ms}ms`) : toast.error(r.data.error || "不通");
    } catch {
      toast.error("测试失败");
    }
  };
  const handleTestAll = async () => {
    setTesting(true);
    try {
      const r = await testAllConfigs();
      setTestResults(r.data.results);
    } catch {
      toast.error("检查失败");
    } finally {
      setTesting(false);
    }
  };

  const secretsMap = new Map(secrets.map((s) => [s.id, s]));

  const ALL = ["patient_chat", "scoring", "qa", "case_generation", "*"];
  const byPurpose: Record<string, LLMConfigResponse[]> = {};
  configs.forEach((c) => {
    if (!byPurpose[c.purpose]) byPurpose[c.purpose] = [];
    byPurpose[c.purpose].push(c);
  });

  const S = {
    card: { border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", overflow: "hidden" } as React.CSSProperties,
    row: {
      display: "flex",
      alignItems: "center",
      padding: "var(--space-2) var(--space-3)",
      borderBottom: "1px solid var(--border-color)",
      gap: "var(--space-3)",
    } as React.CSSProperties,
    rowLast: { display: "flex", alignItems: "center", padding: "var(--space-2) var(--space-3)", gap: "var(--space-3)" } as React.CSSProperties,
    btn: {
      padding: "var(--space-1) var(--space-3)",
      border: "none",
      borderRadius: "var(--radius-md)",
      background: "var(--color-primary)",
      color: "#fff",
      cursor: "pointer",
      fontSize: "0.82rem",
      display: "flex",
      alignItems: "center",
      gap: 4,
    } as React.CSSProperties,
  };

  return (
    <>
      {/* Env fallback — compact */}
      <div style={{ marginBottom: "var(--space-3)", fontSize: "0.78rem" }}>
        <button
          onClick={() => setShowFallback((v) => !v)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {showFallback ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 环境兜底
          {envFallback && <span style={{ ...statusDot(envFallback.available ? "active" : "disabled") }} />}
          <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>sk-...{envFallback?.key_suffix || "****"}</span>
        </button>
        {showFallback && envFallback && (
          <div
            style={{
              marginTop: 4,
              padding: "var(--space-1) var(--space-3)",
              background: "var(--bg-surface-subtle)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-secondary)",
            }}
          >
            {envFallback.model_flash}/{envFallback.model_pro} @ {envFallback.base_url}
            {envFallback.error && <span style={{ color: "var(--red-500)", marginLeft: 8 }}>{envFallback.error}</span>}
          </div>
        )}
      </div>

      {/* Keys */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, margin: 0 }}>API 密钥</h3>
          <button
            onClick={() => {
              setEditingSecret(null);
              setShowSecretModal(true);
            }}
            style={S.btn}
          >
            <Plus size={14} /> 添加
          </button>
        </div>
        {secrets.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "var(--space-4)",
              color: "var(--text-tertiary)",
              fontSize: "0.85rem",
              border: "1px dashed var(--border-color)",
              borderRadius: "var(--radius-md)",
            }}
          >
            暂无密钥 · 添加 DeepSeek API Key 以开始使用
          </div>
        ) : (
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {secrets.map((s) => {
              const myConfigs = configs.filter((c) => c.secret_id === s.id);
              const provider = (s as any).provider || "custom";
              return (
                <div key={s.id} className="card" style={{ flex: "1 1 220px", maxWidth: 300, padding: "var(--space-2) var(--space-3)", position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={providerTag(provider)}>{provider}</span>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>sk-...{s.key_suffix}</div>
                  <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {myConfigs.map((c) => (
                      <span
                        key={c.id}
                        style={{
                          fontSize: "0.65rem",
                          background: c.status === "active" ? "var(--green-50)" : "var(--bg-surface-subtle)",
                          color: c.status === "active" ? "var(--green-700)" : "var(--text-tertiary)",
                          padding: "1px 6px",
                          borderRadius: "var(--radius-full)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <span style={{ ...statusDot(c.status), width: 5, height: 5 }} />
                        {PURPOSE_LABELS[c.purpose] || c.purpose}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", marginTop: 2 }}>本月 ¥{Number(s.monthly_cost_used || 0).toFixed(2)}</div>
                  <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 2 }}>
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

      {/* Purpose bindings */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, margin: 0 }}>用途绑定</h3>
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            <button
              onClick={handleTestAll}
              disabled={testing}
              style={{ ...S.btn, background: testing ? "var(--text-tertiary)" : undefined, opacity: testing ? 0.6 : 1 }}
            >
              <Activity size={14} /> {testing ? "..." : "检查"}
            </button>
            <button
              onClick={() =>
                reloadRouter()
                  .then(() => toast.success("已重载"))
                  .catch(() => toast.error("失败"))
              }
              style={{ ...S.btn, background: "var(--bg-surface-subtle)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={() => {
                setEditingConfig(null);
                setPrefilledConfig(null);
                setShowConfigModal(true);
              }}
              style={S.btn}
            >
              <Plus size={14} /> 添加
            </button>
          </div>
        </div>
        {testResults && (
          <div
            style={{
              padding: "var(--space-1) var(--space-2)",
              marginBottom: "var(--space-2)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.75rem",
              background: testResults.every((r) => r.ok) ? "var(--green-50)" : "var(--amber-50)",
              display: "flex",
              gap: "var(--space-2)",
              flexWrap: "wrap",
            }}
          >
            {testResults.map((r, i) => (
              <span key={i} style={{ color: r.ok ? "var(--green-700)" : "var(--red-600)" }}>
                {r.ok ? "✓" : "✗"} {r.base_url} {r.latency_ms != null ? `${r.latency_ms}ms` : ""}
              </span>
            ))}
          </div>
        )}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>加载中...</div>
        ) : configs.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "var(--space-6)",
              color: "var(--text-tertiary)",
              border: "1px dashed var(--border-color)",
              borderRadius: "var(--radius-md)",
            }}
          >
            暂无用途绑定 · 点击"添加"一键创建
          </div>
        ) : (
          <div style={S.card}>
            {ALL.map((purpose) => {
              const items = (byPurpose[purpose] || []).sort((a, b) => (a.priority || 0) - (b.priority || 0));
              if (items.length === 0) return null;
              return items.map((c, idx) => {
                const isPrimary = idx === 0;
                const secret = secretsMap.get(c.secret_id);
                const isLast = idx === items.length - 1;
                return (
                  <div
                    key={c.id}
                    style={isLast ? { ...S.rowLast, borderTop: idx === 0 ? undefined : "none" } : { ...S.row, borderTop: idx === 0 ? undefined : "none" }}
                  >
                    {isPrimary && <div style={{ width: 120, flexShrink: 0, fontSize: "0.85rem", fontWeight: 600 }}>{PURPOSE_LABELS[purpose] || purpose}</div>}
                    {!isPrimary && <div style={{ width: 120, flexShrink: 0 }} />}
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
                      {!isPrimary && <span style={{ fontSize: "0.65rem", color: "var(--text-tertiary)" }}>↳ 备用</span>}
                      <span style={{ fontFamily: "monospace", fontSize: "0.82rem", fontWeight: isPrimary ? 600 : 400 }}>{c.model}</span>
                      {secret && <span style={providerTag((secret as any).provider || "")}>{(secret as any).provider || "custom"}</span>}
                      <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>{secret?.label || ""}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: "0.8rem",
                          color: c.status === "active" ? "var(--green-700)" : c.status === "degraded" ? "var(--amber-700)" : "var(--red-600)",
                        }}
                      >
                        <span style={statusDot(c.status)} />
                        {statusLabel(c.status)}
                        {c.status === "degraded" && c.degraded_reason && <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>({c.degraded_reason})</span>}
                      </span>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
                        {c.call_count_today ? `${c.call_count_today}次` : ""}
                        {c.total_cost_today ? ` ¥${Number(c.total_cost_today).toFixed(3)}` : ""}
                      </span>
                      <div style={{ display: "flex", gap: 2 }}>
                        <button
                          onClick={() => {
                            setEditingConfig(c);
                            setPrefilledConfig(null);
                            setShowConfigModal(true);
                          }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 2 }}
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
                          title="复制"
                        >
                          <Copy size={12} />
                        </button>
                        {c.status === "degraded" ? (
                          <button
                            onClick={() => handleReset(c)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--amber-500)", padding: 2 }}
                            title="恢复"
                          >
                            <RefreshCw size={12} />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleToggle(c)}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}
                            title={c.status === "active" ? "停用" : "启用"}
                          >
                            <XCircle size={12} style={{ color: c.status === "active" ? "var(--red-400)" : "var(--green-500)" }} />
                          </button>
                        )}
                        <button
                          onClick={() => handleTest(c)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 2 }}
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
                    </div>
                  </div>
                );
              });
            })}
          </div>
        )}
      </div>

      <SecretModal
        open={showSecretModal}
        secret={editingSecret}
        onClose={() => {
          setShowSecretModal(false);
          setEditingSecret(null);
        }}
        onSaved={invalidate}
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
        onSaved={invalidate}
      />
    </>
  );
}
