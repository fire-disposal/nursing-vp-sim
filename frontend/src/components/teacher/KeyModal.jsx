import { useEffect, useState } from "react";
import { createKey, fetchProviders, updateKey } from "../../api/apiManagement";
import { useToast } from "../Toast";
import Modal from "../ui/Modal";

const PURPOSE_OPTIONS = [
  { value: "*", label: "默认（所有场景）" },
  { value: "patient_chat", label: "患者对话" },
  { value: "scoring", label: "评分" },
  { value: "qa", label: "问答" },
];

export default function KeyModal({ open, keyData, onClose, onSaved }) {
  const toast = useToast();
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({
    provider_id: "",
    purpose: "*",
    label: "",
    raw_key: "",
    model: "",
    weight: 100,
    priority: 100,
    price_input_per_1m: 0,
    price_output_per_1m: 0,
    monthly_cost_limit: "",
  });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetchProviders()
        .then(({ data }) => setProviders(data))
        .catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (keyData) {
      setForm({
        provider_id: keyData.provider_id || "",
        purpose: keyData.purpose || "*",
        label: keyData.label || "",
        raw_key: keyData.raw_key || "",
        model: keyData.model || "",
        weight: keyData.weight ?? 100,
        priority: keyData.priority ?? 100,
        price_input_per_1m: keyData.price_input_per_1m ?? 0,
        price_output_per_1m: keyData.price_output_per_1m ?? 0,
        monthly_cost_limit: keyData.monthly_cost_limit ?? "",
      });
    } else {
      setForm({
        provider_id: providers[0]?.id || "",
        purpose: "*",
        label: "",
        raw_key: "",
        model: "",
        weight: 100,
        priority: 100,
        price_input_per_1m: 0,
        price_output_per_1m: 0,
        monthly_cost_limit: "",
      });
    }
    setShowKey(false);
  }, [keyData, open, providers]);

  const handleChange = (field) => (e) => {
    const value = e.target.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.provider_id) {
      toast.error("请选择服务商");
      return;
    }
    if (!form.raw_key && !keyData) {
      toast.error("API Key 为必填项");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.monthly_cost_limit === "" || payload.monthly_cost_limit === null) {
        payload.monthly_cost_limit = null;
      }
      if (keyData) {
        await updateKey(keyData.id, payload);
        toast.success("Key 已更新");
      } else {
        await createKey(payload);
        toast.success("Key 已创建");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "保存失败");
    } finally {
      setSaving(false);
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
      title={keyData ? "编辑 Key" : "添加 Key"}
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
            取消
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
            {saving ? "保存中..." : "保存"}
          </button>
        </>
      }
    >
      <form onSubmit={handleSave}>
        <div style={fieldStyle}>
          <label style={labelStyle}>服务商 *</label>
          <select style={inputStyle} value={form.provider_id} onChange={handleChange("provider_id")} required>
            <option value="">-- 请选择服务商 --</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name || p.name} ({p.base_url})
              </option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>用途</label>
          <select style={inputStyle} value={form.purpose} onChange={handleChange("purpose")}>
            {PURPOSE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>标签</label>
          <input style={inputStyle} value={form.label} onChange={handleChange("label")} placeholder="留空将自动生成" />
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
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>模型</label>
          <input style={inputStyle} value={form.model} onChange={handleChange("model")} placeholder="例如: gpt-4o" />
        </div>
        <div style={fieldStyle}>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
            权重 ({form.weight})
            <span
              title="同一用途下按权重比例分配流量。设为 0 则暂停使用该 key。多个 key 的权重之和为 100% 的分配基准。"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "var(--text-tertiary)",
                color: "#fff",
                fontSize: "0.65rem",
                fontWeight: 700,
                cursor: "help",
              }}
            >
              i
            </span>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={form.weight}
            onChange={handleChange("weight")}
            style={{
              width: "100%",
              accentColor: "var(--color-primary)",
              margin: 0,
            }}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>优先级</label>
          <input style={inputStyle} type="number" value={form.priority} onChange={handleChange("priority")} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>输入价格 (¥/1M tokens)</label>
            <input style={inputStyle} type="number" step="0.01" value={form.price_input_per_1m} onChange={handleChange("price_input_per_1m")} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>输出价格 (¥/1M tokens)</label>
            <input style={inputStyle} type="number" step="0.01" value={form.price_output_per_1m} onChange={handleChange("price_output_per_1m")} />
          </div>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>月度费用上限 (¥)</label>
          <input
            style={inputStyle}
            type="number"
            step="0.01"
            value={form.monthly_cost_limit}
            onChange={handleChange("monthly_cost_limit")}
            placeholder="无限制"
          />
        </div>
      </form>
    </Modal>
  );
}
