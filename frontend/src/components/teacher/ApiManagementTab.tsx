import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronRight, Edit3, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  createConfig,
  deleteConfig,
  deleteSecret,
  fetchConfigs,
  fetchEnvFallback,
  fetchModelPresets,
  fetchSecrets,
  reloadRouter,
  resetConfig,
  testConfig,
  toggleConfig,
} from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import SecretModal from "./SecretModal";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type LLMConfigResponse = components["schemas"]["LLMConfigResponse"];

const PURPOSES = [
  { key: "scoring", label: "评分", desc: "训练对话结束后自动评分" },
  { key: "patient_chat", label: "患者对话", desc: "学生模拟问诊时的患者回复" },
  { key: "qa", label: "问答", desc: "学生自由提问的AI导师" },
  { key: "case_generation", label: "病例生成", desc: "AI辅助生成训练病例" },
  { key: "*", label: "通配兜底", desc: "以上用途未配置时的后备" },
];

const PROVIDER_COLORS: Record<string, string> = { deepseek: "#4f6ef7", openai: "#10a37f", ollama: "#8b5cf6" };
const statusDot = (s: string) => ({
  width: 7,
  height: 7,
  borderRadius: "50%",
  display: "inline-block",
  background: { active: "var(--green-500)", degraded: "var(--amber-500)", disabled: "var(--red-400)" }[s] || "#999",
});

export default function ApiManagementTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [editingSecret, setEditingSecret] = useState<ApiSecretResponse | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  const { data: secrets = [] } = useQuery({ queryKey: ["apiSecrets"], queryFn: () => fetchSecrets().then((r) => r.data) });
  const { data: configs = [] } = useQuery({ queryKey: ["apiConfigs"], queryFn: () => fetchConfigs(undefined).then((r) => r.data) });
  const { data: presets } = useQuery({ queryKey: ["modelPresets"], queryFn: () => fetchModelPresets().then((r) => r.data) });
  const { data: envFallback } = useQuery({ queryKey: ["apiFallback"], queryFn: () => fetchEnvFallback().then((r) => r.data) });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["apiSecrets"] });
    void queryClient.invalidateQueries({ queryKey: ["apiConfigs"] });
  };

  const configsByPurpose: Record<string, LLMConfigResponse[]> = {};
  configs.forEach((c) => {
    if (!configsByPurpose[c.purpose]) configsByPurpose[c.purpose] = [];
    configsByPurpose[c.purpose].push(c);
  });

  const getConfig = (purpose: string) => {
    const items = (configsByPurpose[purpose] || []).sort((a, b) => (a.priority || 0) - (b.priority || 0));
    return items.find((c) => c.status === "active") || items[0] || null;
  };

  const getModelsForSecret = (secretId: number) => {
    if (!presets) return [];
    const secret = secrets.find((s) => s.id === secretId);
    if (!secret) return [];
    const baseUrl = (secret as any).base_url || "";
    for (const p of presets.providers) {
      if (p.base_url && baseUrl.startsWith(p.base_url)) return p.models;
    }
    return [];
  };

  const handleDeleteSecret = async (s: ApiSecretResponse) => {
    if (s.config_count > 0) return toast.error("该档案有用途绑定，先解除");
    if (!(await confirm({ title: "删除档案", message: `删除 "${s.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteSecret(s.id);
      toast.success("已删除");
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "失败");
    }
  };

  const handleDeleteConfig = async (c: LLMConfigResponse) => {
    if (!(await confirm({ title: "解除绑定", message: "移除此用途指派？", confirmText: "解除", danger: true }))) return;
    try {
      await deleteConfig(c.id);
      toast.success("已解除");
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "失败");
    }
  };
  const handleToggle = async (c: LLMConfigResponse) => {
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

  const handleQuickBind = async (purpose: string, secretId: number, model: string) => {
    try {
      await createConfig({ secret_id: secretId, label: "", model, purpose, priority: 10, weight: 10 } as any);
      toast.success("已绑定");
      invalidate();
    } catch (e: any) {
      const msg = typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "绑定失败";
      toast.error(msg);
    }
  };

  const S = {
    card: {
      border: "1px solid var(--border-color)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      marginBottom: "var(--space-3)",
    } as React.CSSProperties,
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
      {/* Env fallback */}
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
          </div>
        )}
      </div>

      {/* API Profiles */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, margin: 0 }}>API 档案</h3>
          <button
            onClick={() => {
              setEditingSecret(null);
              setShowSecretModal(true);
            }}
            style={S.btn}
          >
            <Plus size={14} /> 新建档案
          </button>
        </div>
        {secrets.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "var(--space-5)",
              color: "var(--text-tertiary)",
              border: "1px dashed var(--border-color)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.85rem",
            }}
          >
            暂无档案 · 新建一个 API Key 档案以开始使用
          </div>
        ) : (
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {secrets.map((s) => {
              const provider = (s as any).provider || "custom";
              const myConfigs = configs.filter((c) => c.secret_id === s.id);
              return (
                <div key={s.id} className="card" style={{ flex: "1 1 240px", maxWidth: 320, padding: "var(--space-2) var(--space-3)", position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "0 6px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "0.65rem",
                        fontWeight: 600,
                        background: `${PROVIDER_COLORS[provider] || "#999"}18`,
                        color: PROVIDER_COLORS[provider] || "#666",
                      }}
                    >
                      {provider}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-secondary)" }}>
                    <span style={{ fontFamily: "monospace" }}>sk-...{s.key_suffix}</span>
                    {(s as any).base_url && <span style={{ marginLeft: 6, color: "var(--text-tertiary)" }}>{(s as any).base_url}</span>}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", marginTop: 2 }}>
                    {myConfigs.length} 用途 · 本月 ¥{Number(s.monthly_cost_used || 0).toFixed(2)}
                  </div>
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

      {/* Purpose Assignments */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, margin: 0 }}>用途指派</h3>
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
        </div>
        <div style={S.card}>
          {PURPOSES.map((p, i) => {
            const cfg = getConfig(p.key);
            const isLast = i === PURPOSES.length - 1;
            return (
              <div key={p.key} style={isLast ? S.rowLast : S.row}>
                <div style={{ width: 100, flexShrink: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{p.label}</div>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-tertiary)" }}>{p.desc}</div>
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  {cfg ? (
                    <>
                      <select
                        value={cfg.secret_id}
                        onChange={async (e) => {
                          const newSid = Number(e.target.value);
                          await createConfig({ secret_id: newSid, label: "", model: cfg.model, purpose: p.key, priority: 10, weight: 10 } as any);
                          await deleteConfig(cfg.id);
                          invalidate();
                        }}
                        style={{
                          padding: "2px 6px",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-md)",
                          fontSize: "0.8rem",
                          background: "#fff",
                        }}
                      >
                        {secrets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label} (sk-...{s.key_suffix})
                          </option>
                        ))}
                      </select>
                      <select
                        value={cfg.model}
                        onChange={async (e) => {
                          const newModel = e.target.value;
                          await createConfig({ secret_id: cfg.secret_id, label: "", model: newModel, purpose: p.key, priority: 10, weight: 10 } as any);
                          await deleteConfig(cfg.id);
                          invalidate();
                        }}
                        style={{
                          padding: "2px 6px",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-md)",
                          fontSize: "0.8rem",
                          background: "#fff",
                          fontFamily: "monospace",
                        }}
                      >
                        {getModelsForSecret(cfg.secret_id).map((m: any) => (
                          <option key={m.name} value={m.name}>
                            {m.name}
                          </option>
                        ))}
                        {!getModelsForSecret(cfg.secret_id).find((m: any) => m.name === cfg.model) && <option value={cfg.model}>{cfg.model}</option>}
                      </select>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: "0.78rem",
                          color: cfg.status === "active" ? "var(--green-700)" : cfg.status === "degraded" ? "var(--amber-700)" : "var(--red-600)",
                        }}
                      >
                        <span style={statusDot(cfg.status)} />
                        {cfg.status === "active" ? "正常" : cfg.status === "degraded" ? "熔断" : "关闭"}
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
                        {cfg.call_count_today ? `${cfg.call_count_today}次` : ""}
                        {cfg.total_cost_today ? ` ¥${Number(cfg.total_cost_today).toFixed(3)}` : ""}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: "0.82rem", color: "var(--text-tertiary)" }}>未指派</span>
                  )}
                </div>
                <div style={{ flexShrink: 0, display: "flex", gap: 4, alignItems: "center" }}>
                  {cfg ? (
                    <>
                      {cfg.status === "degraded" ? (
                        <button
                          onClick={() => handleReset(cfg)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--amber-500)", padding: 2 }}
                          title="恢复"
                        >
                          <RefreshCw size={12} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggle(cfg)}
                          title={cfg.status === "active" ? "停用" : "启用"}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 2,
                            color: cfg.status === "active" ? "var(--red-400)" : "var(--green-500)",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                          }}
                        >
                          {cfg.status === "active" ? "停" : "启"}
                        </button>
                      )}
                      <button
                        onClick={() => handleTest(cfg)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 2 }}
                        title="测试"
                      >
                        <Activity size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteConfig(cfg)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red-400)", padding: 2 }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <select
                        onChange={(e) => {
                          const sid = Number(e.target.value);
                          if (!sid) return;
                          const models = getModelsForSecret(sid);
                          handleQuickBind(p.key, sid, models[0]?.name || "deepseek-v4-flash");
                        }}
                        style={{
                          padding: "2px 6px",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-md)",
                          fontSize: "0.75rem",
                          background: "#fff",
                        }}
                      >
                        <option value="">选择档案...</option>
                        {secrets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>选择档案即可绑定</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
    </>
  );
}
