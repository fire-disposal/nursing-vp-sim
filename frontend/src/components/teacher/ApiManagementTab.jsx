import { Activity, CheckCircle, Edit3, Plus, RefreshCw, Server, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkHealth,
  deleteConfig,
  deleteSecret,
  fetchConfigs,
  fetchSecrets,
  reloadRouter,
  resetConfig,
  testAllConfigs,
  testConfig,
  toggleConfig,
} from "../../api/apiManagement";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import ConfigModal from "./ConfigModal";
import SecretModal from "./SecretModal";

const STATUS_COLORS = {
  active: { bg: "var(--green-100)", color: "var(--green-700)" },
  degraded: { bg: "var(--amber-100)", color: "var(--amber-700)" },
  disabled: { bg: "var(--red-100)", color: "var(--red-700)" },
};
const STATUS_LABELS = { active: "正常", degraded: "熔断", disabled: "手动关闭" };
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答", case_generation: "病例生成", "*": "通配" };

export default function ApiManagementTab({ activeSubTab, hideSubTabs = false }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [subTab, setSubTab] = useState(activeSubTab || "configs");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hideSubTabs && activeSubTab) setSubTab(activeSubTab);
  }, [hideSubTabs, activeSubTab]);
  const [secrets, setSecrets] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [health, setHealth] = useState([]);
  const [healthAutoRefresh, setHealthAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [editingSecret, setEditingSecret] = useState(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [testingAll, setTestingAll] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const loadSecrets = useCallback(() => {
    fetchSecrets()
      .then(({ data }) => setSecrets(data))
      .catch((err) => toastRef.current.error(err.response?.data?.detail || "加载密钥失败"));
  }, []);
  const loadConfigs = useCallback(() => {
    setLoading(true);
    fetchConfigs(null)
      .then(({ data }) => setConfigs(data))
      .catch((err) => toastRef.current.error(err.response?.data?.detail || "加载配置失败"))
      .finally(() => setLoading(false));
  }, []);
  const loadHealth = useCallback(() => {
    setLoading(true);
    checkHealth()
      .then(({ data }) => setHealth(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (subTab === "secrets") loadSecrets();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else if (subTab === "configs") loadConfigs();
    else if (subTab === "health") loadHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);
  useEffect(() => {
    if (!healthAutoRefresh || subTab !== "health") return;
    const timer = setInterval(loadHealth, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthAutoRefresh, subTab]);

  const handleDeleteSecret = async (s) => {
    if (s.config_count > 0) {
      toastRef.current.error(`该密钥关联了 ${s.config_count} 个配置，请先删除配置`);
      return;
    }
    if (!(await confirm({ title: "删除密钥", message: `删除 "${s.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteSecret(s.id);
      toast.success("密钥已删除");
      loadSecrets();
    } catch (err) {
      toast.error(err.response?.data?.detail || "删除失败");
    }
  };
  const handleDeleteConfig = async (c) => {
    if (!(await confirm({ title: "删除配置", message: `删除 "${c.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteConfig(c.id);
      toast.success("配置已删除");
      loadConfigs();
    } catch (err) {
      toast.error(err.response?.data?.detail || "删除失败");
    }
  };
  const handleToggle = async (c) => {
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
      loadConfigs();
    } catch (err) {
      toast.error(err.response?.data?.detail || "操作失败");
    }
  };
  const handleReset = async (c) => {
    try {
      await resetConfig(c.id);
      toast.success("已恢复");
      loadConfigs();
    } catch (err) {
      toast.error(err.response?.data?.detail || "恢复失败");
    }
  };
  const handleTest = async (c) => {
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
    } catch (err) {
      toast.error(err.response?.data?.detail || "检查失败");
    } finally {
      setTestingAll(false);
    }
  };

  const groupedConfigs = {};
  configs.forEach((c) => {
    const p = c.purpose;
    if (!groupedConfigs[p]) groupedConfigs[p] = [];
    groupedConfigs[p].push(c);
  });

  const S = {};
  S.table = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
  S.th = {
    padding: "var(--space-2) var(--space-3)",
    textAlign: "left",
    color: "var(--text-secondary)",
    fontWeight: 600,
    borderBottom: "2px solid var(--border-color)",
    fontSize: "0.75rem",
    textTransform: "uppercase",
  };
  S.td = { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color)" };
  S.btn = {
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
  S.badge = (bg, c) => ({ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem", background: bg, color: c });
  S.tabBtn = (active) => ({
    padding: "var(--space-2) var(--space-4)",
    border: "none",
    background: "none",
    fontSize: "0.85rem",
    fontWeight: active ? 600 : 400,
    color: active ? "var(--color-primary)" : "var(--text-secondary)",
    cursor: "pointer",
    borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent",
    marginBottom: -1,
    fontFamily: "inherit",
  });
  S.primaryBtn = {
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
  };

  return (
    <>
      {!hideSubTabs && (
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-color)", marginBottom: "var(--space-5)" }}>
          {[
            { k: "configs", l: "用途配置" },
            { k: "secrets", l: "密钥凭证" },
            { k: "health", l: "连通性" },
          ].map((t) => (
            <button key={t.k} onClick={() => setSubTab(t.k)} style={S.tabBtn(subTab === t.k)}>
              {t.l}
            </button>
          ))}
        </div>
      )}

      {subTab === "secrets" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0 }}>密钥凭证</h3>
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
          <div className="card" style={{ overflow: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>标签</th>
                  <th style={S.th}>Key</th>
                  <th style={S.th}>配置数</th>
                  <th style={S.th}>今日费用</th>
                  <th style={S.th}>本月费用</th>
                  <th style={S.th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {secrets.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>
                      暂无密钥
                    </td>
                  </tr>
                ) : (
                  secrets.map((s) => (
                    <tr key={s.id}>
                      <td style={S.td}>{s.label}</td>
                      <td style={{ ...S.td, fontFamily: "monospace" }}>sk-...{s.key_suffix}</td>
                      <td style={S.td}>{s.config_count}</td>
                      <td style={S.td}>{s.total_cost_today ? `¥${Number(s.total_cost_today).toFixed(4)}` : "-"}</td>
                      <td style={S.td}>{s.monthly_cost_used ? `¥${Number(s.monthly_cost_used).toFixed(4)}` : "-"}</td>
                      <td style={S.td}>
                        <button
                          onClick={() => {
                            setEditingSecret(s);
                            setShowSecretModal(true);
                          }}
                          style={{ ...S.btn, color: "var(--color-primary)" }}
                        >
                          <Edit3 size={12} />
                        </button>
                        <button onClick={() => handleDeleteSecret(s)} style={{ ...S.btn, color: "var(--red-400)" }}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === "configs" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0 }}>用途配置</h3>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <button
                onClick={handleTestAll}
                disabled={testingAll}
                style={{ ...S.primaryBtn, background: testingAll ? "var(--text-tertiary)" : "var(--color-primary)" }}
              >
                <Activity size={14} /> {testingAll ? "检查中..." : "一键检查存活"}
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

          {testResults && (
            <div
              style={{
                padding: "var(--space-2) var(--space-3)",
                marginBottom: "var(--space-3)",
                borderRadius: "var(--radius-md)",
                fontSize: "0.82rem",
                background: testResults.every((r) => r.ok) ? "var(--green-50)" : "var(--amber-50)",
                border: `1px solid ${testResults.every((r) => r.ok) ? "var(--green-200)" : "var(--amber-200)"}`,
                color: "var(--text-primary)",
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
              {testResults.map((r) => (
                <span
                  key={r.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    padding: "1px 6px",
                    borderRadius: "var(--radius-sm)",
                    background: r.ok ? "" : "var(--red-50)",
                    color: r.ok ? "var(--green-700)" : "var(--red-600)",
                    fontWeight: r.ok ? 400 : 600,
                  }}
                >
                  {r.ok ? "✓" : "✗"} {r.label || r.model}
                  {r.latency_ms != null && <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>{r.latency_ms}ms</span>}
                </span>
              ))}
            </div>
          )}
          {loading ? (
            <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>Loading...</div>
          ) : configs.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>
              暂无配置
            </div>
          ) : (
            Object.entries(groupedConfigs).map(([purpose, group]) => (
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
                  {PURPOSE_LABELS[purpose] || purpose} ({group.length} 个配置)
                  {(() => {
                    const sorted = [...group].sort((a, b) => (a.priority || 0) - (b.priority || 0));
                    const active = sorted.find((c) => c.status === "active");
                    if (!active) {
                      const degraded = sorted.find((c) => c.status === "degraded");
                      if (degraded)
                        return <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "var(--amber-600)", fontWeight: 400 }}>(全部熔断中，无可用路由)</span>;
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
                      <th style={S.th}>Secret</th>
                      <th style={S.th}>模型</th>
                      <th style={S.th}>状态</th>
                      <th style={S.th}>调用</th>
                      <th style={S.th}>今日费用</th>
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
                        return (
                          <tr key={c.id} style={isActiveRoute ? { borderLeft: "3px solid var(--green-500)" } : undefined}>
                            <td style={S.td}>{c.priority}</td>
                            <td style={S.td}>{c.label}</td>
                            <td style={{ ...S.td, fontFamily: "monospace", fontSize: "0.8rem" }}>{c.secret_label || `sk-...${c.secret_suffix}`}</td>
                            <td style={S.td}>{c.model}</td>
                            <td style={S.td}>
                              <span style={S.badge(sc.bg, sc.color)} title={c.degraded_reason ? `原因: ${c.degraded_reason}\n恢复: ${c.degraded_until}` : ""}>
                                {displayStatus}
                              </span>
                            </td>
                            <td style={S.td}>{c.call_count_today ?? "-"}</td>
                            <td style={S.td}>{c.total_cost_today != null ? `¥${Number(c.total_cost_today).toFixed(4)}` : "-"}</td>
                            <td style={S.td}>
                              <button
                                onClick={() => {
                                  setEditingConfig(c);
                                  setShowConfigModal(true);
                                }}
                                style={{ ...S.btn, color: "var(--color-primary)" }}
                              >
                                <Edit3 size={12} />
                              </button>
                              <button
                                // eslint-disable-next-line react-hooks/refs
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
                                }}
                              >
                                {c.status === "active" ? "停用" : "启用"}
                              </button>
                              {c.status === "degraded" && (
                                <button onClick={() => handleReset(c)} style={{ ...S.btn, color: "var(--amber-500)" }}>
                                  <RefreshCw size={12} />
                                </button>
                              )}
                              <button onClick={() => handleTest(c)} style={{ ...S.btn, color: "var(--color-primary)" }}>
                                <Activity size={12} />
                              </button>
                              <button onClick={() => handleDeleteConfig(c)} style={{ ...S.btn, color: "var(--red-400)" }}>
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === "health" && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <button onClick={loadHealth} style={S.primaryBtn}>
              <Activity size={14} /> 检查连通性
            </button>
            <button
              onClick={() =>
                reloadRouter()
                  .then(() => toast.success("已重载"))
                  .catch(() => toast.error("重载失败"))
              }
              className="btn btn-secondary"
            >
              <Server size={14} /> 重载路由
            </button>
            <button
              onClick={() => setHealthAutoRefresh((v) => !v)}
              className="btn btn-secondary"
              style={{ background: healthAutoRefresh ? "var(--green-100)" : undefined }}
            >
              <RefreshCw size={14} /> {healthAutoRefresh ? "自动刷新中" : "自动刷新"}
            </button>
          </div>
          <div className="card" style={{ overflow: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>端点</th>
                  <th style={S.th}>状态</th>
                  <th style={S.th}>延迟</th>
                </tr>
              </thead>
              <tbody>
                {health.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>
                      点击"检查连通性"
                    </td>
                  </tr>
                ) : (
                  health.map((h, i) => (
                    <tr key={i}>
                      <td style={S.td}>{h.base_url}</td>
                      <td style={S.td}>
                        <span
                          style={S.badge(h.status === "ok" ? "var(--green-100)" : "var(--red-100)", h.status === "ok" ? "var(--green-700)" : "var(--red-700)")}
                        >
                          {h.status}
                        </span>
                      </td>
                      <td style={S.td}>{h.latency_ms != null ? `${h.latency_ms}ms` : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SecretModal
        open={showSecretModal}
        secret={editingSecret}
        onClose={() => {
          setShowSecretModal(false);
          setEditingSecret(null);
        }}
        onSaved={() => {
          loadSecrets();
        }}
      />
      <ConfigModal
        open={showConfigModal}
        configData={editingConfig}
        onClose={() => {
          setShowConfigModal(false);
          setEditingConfig(null);
        }}
        onSaved={() => {
          loadConfigs().catch(() => {});
        }}
      />
    </>
  );
}
