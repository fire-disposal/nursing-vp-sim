import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Edit3, Trash2, RefreshCw, Server, Activity, AlertTriangle, ChevronUp, ChevronDown, Zap } from "lucide-react";
import {
  fetchProviders, updateProvider, deleteProvider,
  fetchKeys, deleteKey, resetKey,
  reloadRouter, checkHealth, createDeepseekKey,
} from "../../api/apiManagement";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import ProviderModal from "./ProviderModal";
import KeyModal from "./KeyModal";

const STATUS_COLORS = {
  active: { bg: "var(--green-100)", color: "var(--green-700)" },
  rate_limited: { bg: "var(--amber-100)", color: "var(--amber-700)" },
  disabled: { bg: "var(--red-100)", color: "var(--red-700)" },
  paused: { bg: "var(--amber-100)", color: "var(--amber-700)" },
};
const STATUS_LABELS = { active: "正常", rate_limited: "限流中", disabled: "已禁用", paused: "停用" };
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答", "*": "默认（所有场景）" };

export default function ApiManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [subTab, setSubTab] = useState("providers");
  const [providers, setProviders] = useState([]);
  const [keys, setKeys] = useState([]);
  const [health, setHealth] = useState([]);
  const [healthAutoRefresh, setHealthAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [dsKey, setDsKey] = useState("");
  const [dsLabel, setDsLabel] = useState("");
  const [dsSaving, setDsSaving] = useState(false);

  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadProviders = useCallback(() => {
    fetchProviders().then(({ data }) => setProviders(data)).catch((err) => {
      toastRef.current.error(err.response?.data?.detail || err.message || "Failed to load providers");
    });
  }, []);
  const loadKeys = useCallback(() => {
    setLoading(true);
    fetchKeys(null, null).then(({ data }) => setKeys(data)).catch((err) => {
      toastRef.current.error(err.response?.data?.detail || err.message || "Failed to load keys");
    }).finally(() => setLoading(false));
  }, []);
  const loadHealth = useCallback(() => {
    setLoading(true);
    checkHealth().then(({ data }) => setHealth(data)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (subTab === "providers") loadProviders();
    else if (subTab === "keys") loadKeys();
    else if (subTab === "health") loadHealth();
  }, [subTab]);

  useEffect(() => {
    if (!healthAutoRefresh || subTab !== "health") return;
    const timer = setInterval(loadHealth, 30000);
    return () => clearInterval(timer);
  }, [healthAutoRefresh, subTab]);

  const handleMoveProvider = async (index, direction) => {
    const sorted = [...providers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    const ti = index + direction;
    if (ti < 0 || ti >= sorted.length) return;
    const a = sorted[index], b = sorted[ti];
    try {
      await updateProvider(a.id, { ...a, priority: b.priority ?? 0 });
      await updateProvider(b.id, { ...b, priority: a.priority ?? 0 });
      toast.success("Priority swapped");
      loadProviders();
    } catch (err) { toast.error(err.response?.data?.detail || "Reorder failed"); }
  };

  const handleDeleteProvider = async (p) => {
    if (providers.length <= 1) { toastRef.current.error("至少需要保留一个 Provider"); return; }
    if (p.keys_count > 0) { toastRef.current.error(`Cannot delete provider with ${p.keys_count} active keys.`); return; }
    if (!await confirm({ title: "Delete Provider", message: `Delete "${p.name}"?`, confirmText: "Delete", danger: true })) return;
    try { await deleteProvider(p.id); toastRef.current.success("Provider deleted"); loadProviders(); } catch (err) { toastRef.current.error(err.response?.data?.detail || "Delete failed"); }
  };

  const handleDeleteKey = async (k) => {
    if (!await confirm({ title: "Delete Key", message: `Delete "${k.label || k.id}"?`, confirmText: "Delete", danger: true })) return;
    try { await deleteKey(k.id); toast.success("Key deleted"); loadKeys(); } catch (err) { toast.error(err.response?.data?.detail || "Delete failed"); }
  };

  const handleResetKey = async (k) => {
    if (!await confirm({ title: "Reset Key", message: `Reset daily usage for "${k.label || k.id}"?`, confirmText: "Reset" })) return;
    try { await resetKey(k.id); toast.success("Key reset"); loadKeys(); } catch (err) { toast.error(err.response?.data?.detail || "Reset failed"); }
  };

  const handleReload = async () => {
    try { await reloadRouter(); toast.success("Router reloaded"); } catch (err) { toast.error(err.response?.data?.detail || "Reload failed"); }
  };

  const handleQuickAddDS = async () => {
    if (!dsKey.trim() || dsKey.trim().length < 10) { toast.error("请输入有效的 DeepSeek API Key"); return; }
    setDsSaving(true);
    try {
      const resp = await createDeepseekKey(dsKey.trim(), dsLabel.trim() || undefined);
      toast.success(`DeepSeek Key 已添加 (${resp.data.key_suffix})`);
      setDsKey("");
      setDsLabel("");
      loadKeys();
      loadProviders();
    } catch (err) {
      toast.error(err.response?.data?.detail || "添加失败");
    } finally {
      setDsSaving(false);
    }
  };

  const weightTotals = {};
  const groupedKeys = {};
  keys.forEach((k) => {
    const p = k.purpose || "*";
    weightTotals[p] = (weightTotals[p] || 0) + (k.weight || 0);
    if (!groupedKeys[p]) groupedKeys[p] = [];
    groupedKeys[p].push(k);
  });

  const S = {};
  S.table = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
  S.th = { padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--text-secondary)", fontWeight: 600, borderBottom: "2px solid var(--border-color)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" };
  S.td = { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color)" };
  S.btn = { background: "none", border: "none", cursor: "pointer", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-sm)", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 4 };
  S.badge = (bg, c) => ({ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem", background: bg, color: c });
  S.tabBtn = (active) => ({ padding: "var(--space-2) var(--space-4)", border: "none", background: "none", fontSize: "0.85rem", fontWeight: active ? 600 : 400, color: active ? "var(--color-primary)" : "var(--text-secondary)", cursor: "pointer", borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent", marginBottom: -1, fontFamily: "inherit" });
  S.primaryBtn = { padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-1)" };
  S.secondaryBtn = { padding: "var(--space-2) var(--space-4)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-1)" };
  S.empty = { textAlign: "center", color: "var(--text-tertiary)", padding: "var(--space-6)" };

  return (
    <>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-color)", marginBottom: "var(--space-5)" }}>
        {[{ k: "providers", l: "Providers" }, { k: "keys", l: "Keys" }, { k: "health", l: "Health" }].map((t) => (
          <button key={t.k} onClick={() => setSubTab(t.k)} style={S.tabBtn(subTab === t.k)}>{t.l}</button>
        ))}
      </div>

      {/* Providers */}
      {subTab === "providers" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>LLM Providers</h3>
            <button onClick={() => { setEditingProvider(null); setShowProviderModal(true); }} style={S.primaryBtn}>
              <Plus size={14} /> Add Provider
            </button>
          </div>
          <div className="card" style={{ overflow: "auto" }}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}></th><th style={S.th}>Name</th><th style={S.th}>Display Name</th><th style={S.th}>Base URL</th><th style={S.th}>Default Model</th><th style={S.th}>Enabled</th><th style={S.th}>Keys</th><th style={S.th}>Actions</th>
              </tr></thead>
              <tbody>
                {providers.length === 0 ? (
                  <tr><td colSpan={8} style={S.empty}>No providers configured</td></tr>
                ) : [...providers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)).map((p, i, arr) => (
                  <tr key={p.id}>
                    <td style={{ ...S.td, width: 48 }}>
                      <button onClick={() => handleMoveProvider(i, -1)} disabled={i === 0} style={{ ...S.btn, color: i === 0 ? "var(--text-tertiary)" : "var(--text-secondary)", padding: 2 }}><ChevronUp size={14} /></button>
                      <button onClick={() => handleMoveProvider(i, 1)} disabled={i === arr.length - 1} style={{ ...S.btn, color: i === arr.length - 1 ? "var(--text-tertiary)" : "var(--text-secondary)", padding: 2 }}><ChevronDown size={14} /></button>
                    </td>
                    <td style={S.td}>{p.name}</td>
                    <td style={S.td}>{p.display_name || "-"}</td>
                    <td style={{ ...S.td, fontSize: "0.8rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.base_url}</td>
                    <td style={S.td}>{p.default_model || "-"}</td>
                    <td style={S.td}><span style={S.badge(p.is_enabled !== false ? "var(--green-100)" : "var(--red-100)", p.is_enabled !== false ? "var(--green-700)" : "var(--red-700)")}>{p.is_enabled !== false ? "Yes" : "No"}</span></td>
                    <td style={S.td}>{p.keys_count ?? "-"}</td>
                    <td style={S.td}>
                      <button onClick={() => { setEditingProvider(p); setShowProviderModal(true); }} style={{ ...S.btn, color: "var(--color-primary)" }}><Edit3 size={12} /> Edit</button>
                      <button onClick={() => { if (providers.length <= 1) { toastRef.current.error("至少需要保留一个 Provider"); return; } handleDeleteProvider(p); }} disabled={providers.length <= 1} style={{ ...S.btn, color: providers.length <= 1 ? "var(--text-tertiary)" : "var(--red-400)", cursor: providers.length <= 1 ? "not-allowed" : "pointer" }}><Trash2 size={12} /> Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Keys */}
      {subTab === "keys" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>API Keys</h3>
            <button onClick={() => { setEditingKey(null); setShowKeyModal(true); }} style={S.primaryBtn}><Plus size={14} /> Add Key</button>
          </div>

          <div className="card" style={{ padding: "var(--space-4)", marginBottom: "var(--space-4)", background: "linear-gradient(135deg, var(--blue-50), var(--bg-surface))", border: "1px solid var(--blue-200)", borderRadius: "var(--radius-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
              <Zap size={16} style={{ color: "var(--blue-600)" }} />
              <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--blue-700)" }}>快速添加 DeepSeek</span>
              <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginLeft: "auto" }}>自动配置官方参数（模型/价格/地址）</span>
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>API Key</label>
                <input
                  type="password"
                  value={dsKey}
                  onChange={(e) => setDsKey(e.target.value)}
                  placeholder="sk-..."
                  style={{
                    width: "100%", padding: "var(--space-2) var(--space-3)",
                    border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)",
                    fontSize: "0.85rem", boxSizing: "border-box",
                    background: "var(--bg-surface)", color: "var(--text-primary)",
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleQuickAddDS(); }}
                />
              </div>
              <div style={{ width: 180 }}>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>标签（可选）</label>
                <input
                  value={dsLabel}
                  onChange={(e) => setDsLabel(e.target.value)}
                  placeholder="例如: 个人账号"
                  style={{
                    width: "100%", padding: "var(--space-2) var(--space-3)",
                    border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)",
                    fontSize: "0.85rem", boxSizing: "border-box",
                    background: "var(--bg-surface)", color: "var(--text-primary)",
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleQuickAddDS(); }}
                />
              </div>
              <button
                onClick={handleQuickAddDS}
                disabled={dsSaving}
                style={{
                  padding: "var(--space-2) var(--space-4)", border: "none",
                  borderRadius: "var(--radius-md)", background: "var(--blue-600)",
                  color: "#fff", cursor: dsSaving ? "not-allowed" : "pointer",
                  fontSize: "0.85rem", fontWeight: 600, whiteSpace: "nowrap",
                  opacity: dsSaving ? 0.6 : 1, height: 38,
                }}
              >
                {dsSaving ? "添加中..." : "添加 DeepSeek Key"}
              </button>
            </div>
            <div style={{ marginTop: "var(--space-2)", fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
              将自动配置：模型 deepseek-v4-flash · 价格 ¥1/¥2 每百万token（输入/输出）· 地址 api.deepseek.com
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>Loading...</div>
          ) : keys.length === 0 ? (
            <div className="card" style={S.empty}>No keys configured</div>
          ) : ["patient_chat", "scoring", "qa", "*"].map((purpose) => {
            const group = groupedKeys[purpose];
            if (!group || group.length === 0) return null;
            const total = weightTotals[purpose] || 1;
            return (
              <div key={purpose} style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)", overflow: "hidden" }}>
                <div style={{ padding: "var(--space-3) var(--space-4)", background: "var(--bg-surface-subtle)", borderBottom: "1px solid var(--border-color)", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>
                  {PURPOSE_LABELS[purpose] || purpose} ({group.length} 个账号)
                </div>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>Label</th><th style={S.th}>Provider</th><th style={S.th}>Key</th><th style={S.th}>Model</th><th style={S.th}>Weight</th><th style={S.th}>Status</th><th style={S.th}>Calls</th><th style={S.th}>Cost</th><th style={S.th}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {group.map((k) => {
                      const pct = total > 0 ? ((k.weight || 0) / total * 100) : 0;
                      const warn = k.monthly_cost_limit && k.total_cost_today != null && Number(k.total_cost_today) >= Number(k.monthly_cost_limit) * 0.9;
                      const displayStatus = (k.weight ?? 10) === 0 ? "paused" : k.status;
                      const sc = STATUS_COLORS[displayStatus] || STATUS_COLORS.disabled;
                      return (
                        <tr key={k.id}>
                          <td style={S.td}>{k.label || `key-${k.id}`}</td>
                          <td style={S.td}>{k.provider_name || k.provider_id}</td>
                          <td style={{ ...S.td, fontFamily: "monospace", fontSize: "0.8rem" }}>sk-...{k.key_suffix || "****"}</td>
                          <td style={S.td}>{k.model || "-"}</td>
                          <td style={S.td}>
                            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                              <div style={{ flex: 1, height: 7, background: "var(--border-color)", borderRadius: "var(--radius-full)", overflow: "hidden", minWidth: 60 }}>
                                <div style={{ height: "100%", width: `${Math.max(pct, 2)}%`, background: "var(--color-primary)", borderRadius: "var(--radius-full)", transition: "width 0.3s ease" }} />
                              </div>
                              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", minWidth: 36, textAlign: "right" }}>{Math.round(pct)}%</span>
                            </div>
                          </td>
                          <td style={S.td}><span style={S.badge(sc.bg, sc.color)}>{STATUS_LABELS[displayStatus] || displayStatus}</span></td>
                          <td style={S.td}>{k.call_count_today ?? "-"}</td>
                          <td style={S.td}>
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {k.total_cost_today != null ? `¥${Number(k.total_cost_today).toFixed(4)}` : "-"}
                              {warn && <AlertTriangle size={12} style={{ color: "var(--amber-500)" }} title="接近月度费用上限" />}
                            </span>
                          </td>
                          <td style={S.td}>
                            <button onClick={() => { setEditingKey(k); setShowKeyModal(true); }} style={{ ...S.btn, color: "var(--color-primary)" }}><Edit3 size={12} /></button>
                            <button onClick={() => handleResetKey(k)} style={{ ...S.btn, color: "var(--amber-500)" }}><RefreshCw size={12} /></button>
                            <button onClick={() => handleDeleteKey(k)} style={{ ...S.btn, color: "var(--red-400)" }}><Trash2 size={12} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Health */}
      {subTab === "health" && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <button onClick={loadHealth} style={S.primaryBtn}><Activity size={14} /> Check Health</button>
            <button onClick={handleReload} style={S.secondaryBtn}><Server size={14} /> Reload Router</button>
            <button
              onClick={() => setHealthAutoRefresh((v) => !v)}
              style={{ ...S.secondaryBtn, background: healthAutoRefresh ? "var(--green-100)" : undefined, color: healthAutoRefresh ? "var(--green-700)" : undefined }}
            >
              <RefreshCw size={14} style={{ animation: healthAutoRefresh ? "spin 2s linear infinite" : undefined }} />
              {healthAutoRefresh ? "自动刷新中" : "自动刷新"}
            </button>
          </div>
          <div className="card" style={{ overflow: "auto" }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>Loading...</div>
            ) : (
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Provider</th><th style={S.th}>Status</th><th style={S.th}>Latency</th>
                </tr></thead>
                <tbody>
                  {health.length === 0 ? (
                    <tr><td colSpan={3} style={S.empty}>Click "Check Health" to test providers</td></tr>
                  ) : health.map((h, i) => (
                    <tr key={i}>
                      <td style={S.td}>{h.provider_name || h.id}</td>
                      <td style={S.td}><span style={S.badge(h.status === "ok" ? "var(--green-100)" : "var(--red-100)", h.status === "ok" ? "var(--green-700)" : "var(--red-700)")}>{h.status || "unknown"}</span></td>
                      <td style={S.td}>{h.latency_ms != null ? `${h.latency_ms}ms` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <ProviderModal
        open={showProviderModal} provider={editingProvider}
        onClose={() => { setShowProviderModal(false); setEditingProvider(null); }}
        onSaved={loadProviders}
      />
      <KeyModal
        open={showKeyModal} keyData={editingKey}
        onClose={() => { setShowKeyModal(false); setEditingKey(null); }}
        onSaved={() => { loadKeys(); loadProviders(); }}
      />
    </>
  );
}
