import { useState, useEffect, useCallback } from "react";
import { Plus, Edit3, Trash2, RefreshCw, Server, Activity } from "lucide-react";
import {
  fetchProviders, deleteProvider,
  fetchKeys, deleteKey, resetKey, fetchKeyStats,
  reloadRouter, checkHealth,
} from "../../api/apiManagement";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import ProviderModal from "./ProviderModal";
import KeyModal from "./KeyModal";

const STATUS_COLORS = {
  active: { bg: "var(--green-100)", color: "var(--green-700)" },
  rate_limited: { bg: "var(--amber-100)", color: "var(--amber-700)" },
  disabled: { bg: "var(--red-100)", color: "var(--red-700)" },
};

export default function ApiManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();

  const [subTab, setSubTab] = useState("providers");
  const [providers, setProviders] = useState([]);
  const [keys, setKeys] = useState([]);
  const [health, setHealth] = useState([]);
  const [loading, setLoading] = useState(false);

  const [keyFilters, setKeyFilters] = useState({ provider_id: "", status: "" });
  const [expandedKey, setExpandedKey] = useState(null);
  const [keyStats, setKeyStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [showProviderModal, setShowProviderModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [editingKey, setEditingKey] = useState(null);

  const loadProviders = useCallback(() => {
    fetchProviders().then(({ data }) => setProviders(data)).catch(() => toast.error("Failed to load providers"));
  }, [toast]);

  const loadKeys = useCallback(() => {
    setLoading(true);
    fetchKeys(keyFilters.provider_id || null, keyFilters.status || null)
      .then(({ data }) => setKeys(data))
      .catch(() => toast.error("Failed to load keys"))
      .finally(() => setLoading(false));
  }, [keyFilters, toast]);

  const loadHealth = useCallback(() => {
    setLoading(true);
    checkHealth()
      .then(({ data }) => setHealth(data))
      .catch(() => toast.error("Failed to check health"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    if (subTab === "providers") loadProviders();
    else if (subTab === "keys") loadKeys();
    else if (subTab === "health") loadHealth();
  }, [subTab, loadProviders, loadKeys, loadHealth]);

  const toggleKeyExpand = async (key) => {
    if (expandedKey === key.id) {
      setExpandedKey(null);
      setKeyStats(null);
      return;
    }
    setExpandedKey(key.id);
    setStatsLoading(true);
    try {
      const { data } = await fetchKeyStats(key.id);
      setKeyStats(data);
    } catch {
      setKeyStats(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleDeleteProvider = async (p) => {
    if (p.keys_count > 0) {
      toast.error(`Cannot delete provider with ${p.keys_count} active keys. Remove keys first.`);
      return;
    }
    const ok = await confirm({ title: "Delete Provider", message: `Delete "${p.name}"? This cannot be undone.`, confirmText: "Delete", danger: true });
    if (!ok) return;
    try {
      await deleteProvider(p.id);
      toast.success("Provider deleted");
      loadProviders();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Delete failed");
    }
  };

  const handleDeleteKey = async (k) => {
    const ok = await confirm({ title: "Delete Key", message: `Delete key "${k.label || k.id}"?`, confirmText: "Delete", danger: true });
    if (!ok) return;
    try {
      await deleteKey(k.id);
      toast.success("Key deleted");
      loadKeys();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Delete failed");
    }
  };

  const handleResetKey = async (k) => {
    const ok = await confirm({ title: "Reset Key", message: `Reset daily usage for "${k.label || k.id}"?`, confirmText: "Reset" });
    if (!ok) return;
    try {
      await resetKey(k.id);
      toast.success("Key reset");
      loadKeys();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Reset failed");
    }
  };

  const handleReload = async () => {
    try {
      await reloadRouter();
      toast.success("Router reloaded");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Reload failed");
    }
  };

  const subTabs = [
    { key: "providers", label: "Providers" },
    { key: "keys", label: "Keys" },
    { key: "health", label: "Health" },
  ];

  const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
  const thStyle = { padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--text-secondary)", fontWeight: 600, borderBottom: "2px solid var(--border-color)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" };
  const tdStyle = { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color)" };
  const actionBtnStyle = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "var(--space-1) var(--space-2)",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.75rem",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };

  return (
    <>
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border-color)",
        marginBottom: "var(--space-5)",
        gap: 0,
      }}>
        {subTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key)}
            style={{
              padding: "var(--space-2) var(--space-4)",
              border: "none",
              background: "none",
              fontSize: "0.85rem",
              fontWeight: subTab === tab.key ? 600 : 400,
              color: subTab === tab.key ? "var(--color-primary)" : "var(--text-secondary)",
              cursor: "pointer",
              borderBottom: subTab === tab.key ? "2px solid var(--color-primary)" : "2px solid transparent",
              marginBottom: -1,
              fontFamily: "inherit",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Providers Sub-tab */}
      {subTab === "providers" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>LLM Providers</h3>
            <button
              onClick={() => { setEditingProvider(null); setShowProviderModal(true); }}
              style={{
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
              }}
            >
              <Plus size={14} /> Add Provider
            </button>
          </div>

          <div className="card" style={{ overflow: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Display Name</th>
                  <th style={thStyle}>Base URL</th>
                  <th style={thStyle}>Default Model</th>
                  <th style={thStyle}>Enabled</th>
                  <th style={thStyle}>Keys</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {providers.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "var(--text-tertiary)", padding: "var(--space-6)" }}>
                      No providers configured
                    </td>
                  </tr>
                ) : providers.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>{p.name}</td>
                    <td style={tdStyle}>{p.display_name || "-"}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.8rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.base_url}</td>
                    <td style={tdStyle}>{p.default_model || "-"}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "0.75rem",
                        background: p.is_enabled !== false ? "var(--green-100)" : "var(--red-100)",
                        color: p.is_enabled !== false ? "var(--green-700)" : "var(--red-700)",
                      }}>
                        {p.is_enabled !== false ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={tdStyle}>{p.keys_count ?? "-"}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => { setEditingProvider(p); setShowProviderModal(true); }}
                        style={{ ...actionBtnStyle, color: "var(--color-primary)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface-subtle)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                      >
                        <Edit3 size={12} /> Edit
                      </button>
                      <button
                        onClick={() => handleDeleteProvider(p)}
                        style={{ ...actionBtnStyle, color: "var(--red-400)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--red-50)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Keys Sub-tab */}
      {subTab === "keys" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: "var(--space-3)" }}>
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
              <select
                value={keyFilters.provider_id}
                onChange={(e) => setKeyFilters((f) => ({ ...f, provider_id: e.target.value }))}
                style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)" }}
              >
                <option value="">All Providers</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name || p.name}</option>
                ))}
              </select>
              <select
                value={keyFilters.status}
                onChange={(e) => setKeyFilters((f) => ({ ...f, status: e.target.value }))}
                style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)" }}
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="rate_limited">Rate Limited</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <button
              onClick={() => { setEditingKey(null); setShowKeyModal(true); }}
              style={{
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
              }}
            >
              <Plus size={14} /> Add Key
            </button>
          </div>

          <div className="card" style={{ overflow: "auto" }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>Loading...</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Label</th>
                    <th style={thStyle}>Provider</th>
                    <th style={thStyle}>Key</th>
                    <th style={thStyle}>Model</th>
                    <th style={thStyle}>Weight</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Today Calls</th>
                    <th style={thStyle}>Today Cost</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "var(--text-tertiary)", padding: "var(--space-6)" }}>
                        No keys configured
                      </td>
                    </tr>
                  ) : keys.map((k) => (
                    <>
                      <tr
                        key={k.id}
                        onClick={() => toggleKeyExpand(k)}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface-subtle)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
                      >
                        <td style={tdStyle}>{k.label || `key-${k.id}`}</td>
                        <td style={tdStyle}>{k.provider_name || k.provider_id}</td>
                        <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.8rem" }}>
                          {k.masked_key || "sk-****"}
                        </td>
                        <td style={tdStyle}>{k.model || "-"}</td>
                        <td style={tdStyle}>{k.weight}</td>
                        <td style={tdStyle}>
                          <span style={{
                            padding: "2px 8px",
                            borderRadius: "var(--radius-full)",
                            fontSize: "0.75rem",
                            background: (STATUS_COLORS[k.status] || STATUS_COLORS.disabled).bg,
                            color: (STATUS_COLORS[k.status] || STATUS_COLORS.disabled).color,
                          }}>
                            {k.status}
                          </span>
                        </td>
                        <td style={tdStyle}>{k.today_calls ?? "-"}</td>
                        <td style={tdStyle}>{k.today_cost != null ? `$${Number(k.today_cost).toFixed(4)}` : "-"}</td>
                        <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => { setEditingKey(k); setShowKeyModal(true); }}
                            style={{ ...actionBtnStyle, color: "var(--color-primary)" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface-subtle)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                          >
                            <Edit3 size={12} />
                          </button>
                          <button
                            onClick={() => handleResetKey(k)}
                            style={{ ...actionBtnStyle, color: "var(--amber-500)" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--amber-50)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                          >
                            <RefreshCw size={12} />
                          </button>
                          <button
                            onClick={() => handleDeleteKey(k)}
                            style={{ ...actionBtnStyle, color: "var(--red-400)" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--red-50)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                      {expandedKey === k.id && (
                        <tr key={`${k.id}-stats`}>
                          <td colSpan={9} style={{ padding: "var(--space-4) var(--space-3)", background: "var(--bg-surface-subtle)", borderBottom: "1px solid var(--border-color)" }}>
                            {statsLoading ? (
                              <div style={{ textAlign: "center", padding: "var(--space-4)", color: "var(--text-secondary)" }}>Loading stats...</div>
                            ) : keyStats ? (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                                <div>
                                  <h4 style={{ fontSize: "0.8rem", fontWeight: 600, margin: "0 0 var(--space-2) 0", color: "var(--text-secondary)" }}>30-Day Usage</h4>
                                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                    <div style={{ marginBottom: 4 }}>Calls: {keyStats.total_calls_30d ?? "-"}</div>
                                    <div>Cost: {keyStats.total_cost_30d != null ? `$${Number(keyStats.total_cost_30d).toFixed(4)}` : "-"}</div>
                                  </div>
                                </div>
                                <div>
                                  <h4 style={{ fontSize: "0.8rem", fontWeight: 600, margin: "0 0 var(--space-2) 0", color: "var(--text-secondary)" }}>Breakdown by Purpose</h4>
                                  {keyStats.by_purpose && keyStats.by_purpose.length > 0 ? (
                                    <table style={{ ...tableStyle, fontSize: "0.75rem" }}>
                                      <thead>
                                        <tr>
                                          <th style={{ ...thStyle, fontSize: "0.7rem" }}>Purpose</th>
                                          <th style={{ ...thStyle, fontSize: "0.7rem" }}>Calls</th>
                                          <th style={{ ...thStyle, fontSize: "0.7rem" }}>Cost</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {keyStats.by_purpose.map((bp, i) => (
                                          <tr key={i}>
                                            <td style={tdStyle}>{bp.purpose}</td>
                                            <td style={tdStyle}>{bp.count}</td>
                                            <td style={tdStyle}>{bp.cost != null ? `$${Number(bp.cost).toFixed(4)}` : "-"}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>No data</div>
                                  )}
                                </div>
                                {keyStats.recent_errors && keyStats.recent_errors.length > 0 && (
                                  <div style={{ gridColumn: "1 / -1" }}>
                                    <h4 style={{ fontSize: "0.8rem", fontWeight: 600, margin: "0 0 var(--space-2) 0", color: "var(--red-500)" }}>Recent Errors</h4>
                                    <div style={{ fontSize: "0.75rem", maxHeight: 120, overflowY: "auto" }}>
                                      {keyStats.recent_errors.map((err, i) => (
                                        <div key={i} style={{ padding: "var(--space-1) 0", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)" }}>
                                          {err.time ? `${err.time}: ` : ""}{err.message || err.error}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Health Sub-tab */}
      {subTab === "health" && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <button
              onClick={loadHealth}
              style={{
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
              }}
            >
              <Activity size={14} /> Check Health
            </button>
            <button
              onClick={handleReload}
              style={{
                padding: "var(--space-2) var(--space-4)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
                cursor: "pointer",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
              }}
            >
              <Server size={14} /> Reload Router
            </button>
          </div>

          <div className="card" style={{ overflow: "auto" }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>Loading...</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Provider</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {health.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ ...tdStyle, textAlign: "center", color: "var(--text-tertiary)", padding: "var(--space-6)" }}>
                        Click "Check Health" to test providers
                      </td>
                    </tr>
                  ) : health.map((h, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{h.provider || h.name || h.id}</td>
                      <td style={tdStyle}>
                        <span style={{
                          padding: "2px 8px",
                          borderRadius: "var(--radius-full)",
                          fontSize: "0.75rem",
                          background: h.status === "ok" ? "var(--green-100)" : "var(--red-100)",
                          color: h.status === "ok" ? "var(--green-700)" : "var(--red-700)",
                        }}>
                          {h.status || "unknown"}
                        </span>
                      </td>
                      <td style={tdStyle}>{h.latency_ms != null ? `${h.latency_ms}ms` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <ProviderModal
        open={showProviderModal}
        provider={editingProvider}
        onClose={() => { setShowProviderModal(false); setEditingProvider(null); }}
        onSaved={loadProviders}
      />
      <KeyModal
        open={showKeyModal}
        keyData={editingKey}
        onClose={() => { setShowKeyModal(false); setEditingKey(null); }}
        onSaved={() => { loadKeys(); loadProviders(); }}
      />
    </>
  );
}
