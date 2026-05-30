import { useState, useEffect } from "react";
import Modal from "../ui/Modal";
import { createKey, updateKey, fetchKeyRules, createKeyRule, deleteKeyRule, fetchProviders } from "../../api/apiManagement";
import { useToast } from "../Toast";

const PURPOSE_OPTIONS = ["patient_chat", "scoring", "qa", "summary", "*"];

export default function KeyModal({ open, keyData, onClose, onSaved }) {
  const toast = useToast();
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({
    provider_id: "",
    label: "",
    raw_key: "",
    model: "",
    weight: 100,
    price_input: 0,
    price_output: 0,
    monthly_cost_limit: "",
  });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState({ purpose: "*", priority: 100 });

  useEffect(() => {
    if (open) {
      fetchProviders().then(({ data }) => setProviders(data)).catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (keyData) {
      setForm({
        provider_id: keyData.provider_id || "",
        label: keyData.label || "",
        raw_key: keyData.raw_key || "",
        model: keyData.model || "",
        weight: keyData.weight ?? 100,
        price_input: keyData.price_input ?? 0,
        price_output: keyData.price_output ?? 0,
        monthly_cost_limit: keyData.monthly_cost_limit ?? "",
      });
      fetchKeyRules(keyData.id).then(({ data }) => setRules(data)).catch(() => setRules([]));
    } else {
      setForm({
        provider_id: providers[0]?.id || "",
        label: "",
        raw_key: "",
        model: "",
        weight: 100,
        price_input: 0,
        price_output: 0,
        monthly_cost_limit: "",
      });
      setRules([]);
    }
    setShowKey(false);
    setNewRule({ purpose: "*", priority: 100 });
  }, [keyData, open, providers]);

  const handleChange = (field) => (e) => {
    const value = e.target.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.provider_id) { toast.error("Please select a provider"); return; }
    if (!form.raw_key && !keyData) { toast.error("API key is required"); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.monthly_cost_limit === "" || payload.monthly_cost_limit === null) {
        payload.monthly_cost_limit = null;
      }
      if (keyData) {
        await updateKey(keyData.id, payload);
        toast.success("Key updated");
      } else {
        await createKey(payload);
        toast.success("Key created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addRule = async () => {
    if (!keyData) { toast.error("Save the key first before adding rules"); return; }
    try {
      const { data } = await createKeyRule(keyData.id, newRule);
      setRules((r) => [...r, data]);
      setNewRule({ purpose: "*", priority: 100 });
      toast.success("Rule added");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to add rule");
    }
  };

  const removeRule = async (ruleId) => {
    try {
      await deleteKeyRule(ruleId);
      setRules((r) => r.filter((rule) => rule.id !== ruleId));
      toast.success("Rule deleted");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete rule");
    }
  };

  const fieldStyle = {
    marginBottom: "var(--space-4)",
  };
  const labelStyle = {
    display: "block",
    fontSize: "0.85rem",
    fontWeight: 600,
    marginBottom: "var(--space-1)",
    color: "var(--text-secondary)",
  };
  const inputStyle = {
    width: "100%",
    padding: "var(--space-2) var(--space-3)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-md)",
    fontSize: "0.9rem",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    boxSizing: "border-box",
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={keyData ? "Edit Key" : "Add Key"}
      maxWidth={640}
      footer={
        <>
          <button
            onClick={onClose}
            style={{
              padding: "var(--space-2) var(--space-4)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-surface)",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "var(--space-2) var(--space-4)",
              border: "none",
              borderRadius: "var(--radius-md)",
              background: "var(--color-primary)",
              color: "#fff",
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: "0.85rem",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </>
      }
    >
      <form onSubmit={handleSave}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Provider *</label>
          <select style={inputStyle} value={form.provider_id} onChange={handleChange("provider_id")} required>
            <option value="">-- Select Provider --</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name || p.name} ({p.base_url})</option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Label</label>
          <input style={inputStyle} value={form.label} onChange={handleChange("label")} placeholder="Auto-generated if empty" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>API Key {!keyData && "*"}</label>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              type={showKey ? "text" : "password"}
              value={form.raw_key}
              onChange={handleChange("raw_key")}
              placeholder="sk-..."
              required={!keyData}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              style={{
                padding: "var(--space-2) var(--space-3)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.75rem",
                whiteSpace: "nowrap",
              }}
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Model</label>
          <input style={inputStyle} value={form.model} onChange={handleChange("model")} placeholder="e.g. gpt-4o" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Weight</label>
            <input style={inputStyle} type="number" value={form.weight} onChange={handleChange("weight")} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Price Input ($/1M)</label>
            <input style={inputStyle} type="number" step="0.01" value={form.price_input} onChange={handleChange("price_input")} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Price Output ($/1M)</label>
            <input style={inputStyle} type="number" step="0.01" value={form.price_output} onChange={handleChange("price_output")} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Monthly Cost Limit ($)</label>
            <input style={inputStyle} type="number" step="0.01" value={form.monthly_cost_limit} onChange={handleChange("monthly_cost_limit")} placeholder="No limit" />
          </div>
        </div>
      </form>

      {keyData && (
        <div style={{ marginTop: "var(--space-5)", borderTop: "1px solid var(--border-color)", paddingTop: "var(--space-4)" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "var(--space-3)", color: "var(--text-secondary)" }}>Routing Rules</h3>
          {rules.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "var(--space-3)", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color)", textAlign: "left" }}>
                  <th style={{ padding: "var(--space-1) var(--space-2)", color: "var(--text-secondary)" }}>Purpose</th>
                  <th style={{ padding: "var(--space-1) var(--space-2)", color: "var(--text-secondary)" }}>Priority</th>
                  <th style={{ padding: "var(--space-1) var(--space-2)", color: "var(--text-secondary)" }}>Enabled</th>
                  <th style={{ padding: "var(--space-1) var(--space-2)", color: "var(--text-secondary)", width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "var(--space-1) var(--space-2)" }}><span style={{ padding: "1px 6px", borderRadius: "var(--radius-full)", fontSize: "0.75rem", background: "var(--bg-surface-subtle)" }}>{rule.purpose}</span></td>
                    <td style={{ padding: "var(--space-1) var(--space-2)" }}>{rule.priority}</td>
                    <td style={{ padding: "var(--space-1) var(--space-2)" }}>{rule.enabled ? "Yes" : "No"}</td>
                    <td style={{ padding: "var(--space-1) var(--space-2)" }}>
                      <button
                        type="button"
                        onClick={() => removeRule(rule.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--red-400)",
                          cursor: "pointer",
                          fontSize: "0.75rem",
                          padding: 0,
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: "var(--text-tertiary)", fontSize: "0.85rem", marginBottom: "var(--space-3)" }}>No rules configured</div>
          )}
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...labelStyle, fontSize: "0.75rem" }}>Purpose</label>
              <select style={{ ...inputStyle, fontSize: "0.8rem" }} value={newRule.purpose} onChange={(e) => setNewRule((r) => ({ ...r, purpose: e.target.value }))}>
                {PURPOSE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ width: 100 }}>
              <label style={{ ...labelStyle, fontSize: "0.75rem" }}>Priority</label>
              <input style={{ ...inputStyle, fontSize: "0.8rem" }} type="number" value={newRule.priority} onChange={(e) => setNewRule((r) => ({ ...r, priority: Number(e.target.value) || 100 }))} />
            </div>
            <button
              type="button"
              onClick={addRule}
              style={{
                padding: "var(--space-2) var(--space-3)",
                border: "none",
                borderRadius: "var(--radius-md)",
                background: "var(--color-primary)",
                color: "#fff",
                cursor: "pointer",
                fontSize: "0.8rem",
                whiteSpace: "nowrap",
              }}
            >
              Add Rule
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
