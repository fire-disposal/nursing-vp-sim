import { useCallback, useEffect, useState } from "react";
import { createConfig, fetchSecrets, updateConfig } from "../../api/apiManagement";
import { useToast } from "../Toast";
import Modal from "../ui/Modal";

const PURPOSES = [
  { value: "*", label: "通配 (全部)" },
  { value: "qa", label: "问答 (QA)" },
  { value: "patient_chat", label: "患者对话" },
  { value: "scoring", label: "评分" },
  { value: "case_generation", label: "病例生成" },
];

const MODEL_PRESETS = [
  {
    label: "DeepSeek V4 Pro",
    model: "deepseek-v4-pro",
    base_url: "https://api.deepseek.com",
    price_input_per_1m: 1,
    price_output_per_1m: 2,
  },
  {
    label: "DeepSeek V4 Flash",
    model: "deepseek-v4-flash",
    base_url: "https://api.deepseek.com",
    price_input_per_1m: 0.5,
    price_output_per_1m: 0.5,
  },
];

export default function ConfigModal({ open, configData, onClose, onSaved }) {
  const [mode, setMode] = useState("form");
  const [secrets, setSecrets] = useState([]);
  const [secretsLoaded, setSecretsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const isEdit = configData != null;

  const newFormDefaults = useCallback(() => {
    const sid = secrets.length > 0 ? secrets[0].id : "";
    return {
      secret_id: sid,
      label: "",
      base_url: "",
      model: "",
      purpose: "qa",
      priority: 10,
      price_input_per_1m: 1,
      price_output_per_1m: 2,
      monthly_cost_limit: "",
    };
  }, [secrets]);

  const [form, setForm] = useState({
    secret_id: "",
    label: "",
    base_url: "",
    model: "",
    purpose: "qa",
    priority: 10,
    price_input_per_1m: 1,
    price_output_per_1m: 2,
    monthly_cost_limit: "",
  });
  const [jsonText, setJsonText] = useState("");
  const [preset, setPreset] = useState("");

  const applyPreset = (key) => {
    if (!key) return;
    const p = MODEL_PRESETS.find((m) => m.model === key);
    if (!p) return;
    updateField("model", p.model);
    updateField("base_url", p.base_url);
    updateField("price_input_per_1m", p.price_input_per_1m);
    updateField("price_output_per_1m", p.price_output_per_1m);
    setPreset("");
  };

  useEffect(() => {
    if (open) {
      fetchSecrets()
        .then(({ data }) => {
          setSecrets(data);
          setSecretsLoaded(true);
        })
        .catch(() => setSecretsLoaded(true));
      if (configData) {
        const f = {
          secret_id: String(configData.secret_id || ""),
          label: configData.label || "",
          base_url: configData.base_url || "",
          model: configData.model || "",
          purpose: configData.purpose || "qa",
          priority: configData.priority || 10,
          price_input_per_1m: configData.price_input_per_1m ?? 1,
          price_output_per_1m: configData.price_output_per_1m ?? 2,
          monthly_cost_limit: configData.monthly_cost_limit ?? "",
        };
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setForm(f);
        setJsonText(JSON.stringify(configData, null, 2));
      } else {
        setForm(newFormDefaults());
        setJsonText("");
      }
    }
  }, [open, configData, newFormDefaults]);

  const updateField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const sanitizePayload = (raw) => {
    const data = { ...raw };
    const sid = Number(data.secret_id);
    if (!Number.isFinite(sid) || sid <= 0) return null;
    data.secret_id = sid;
    data.priority = Number(data.priority);
    if (!Number.isFinite(data.priority) || data.priority < 1) data.priority = 10;
    if (typeof data.price_input_per_1m !== "number") data.price_input_per_1m = Number(data.price_input_per_1m) || 0;
    if (typeof data.price_output_per_1m !== "number") data.price_output_per_1m = Number(data.price_output_per_1m) || 0;
    if (data.monthly_cost_limit === "" || data.monthly_cost_limit === undefined || data.monthly_cost_limit === null) {
      delete data.monthly_cost_limit;
    } else {
      data.monthly_cost_limit = Number(data.monthly_cost_limit);
    }
    return data;
  };

  const handleSave = async () => {
    let data;
    try {
      const raw = mode === "json" ? JSON.parse(jsonText) : { ...form };
      data = sanitizePayload(raw);
    } catch {
      error("JSON 格式无效");
      return;
    }
    if (!data) {
      error("请选择密钥凭证");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateConfig(configData.id, data);
        success("配置已更新");
      } else {
        await createConfig(data);
        success("配置已创建");
      }
      onSaved();
      onClose();
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (typeof detail === "string") error(detail);
      else if (detail && Array.isArray(detail)) error(detail.map((d) => d.msg || JSON.stringify(d)).join("; "));
      else error(`保存失败 (${e.response?.status || e.message})`);
    } finally {
      setSaving(false);
    }
  };

  const switchToJson = () => {
    setJsonText(JSON.stringify(form, null, 2));
    setMode("json");
  };
  const switchToForm = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setForm((prev) => ({ ...prev, ...parsed }));
      setMode("form");
    } catch {
      error("当前 JSON 格式无效，无法切换");
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "var(--space-2) var(--space-3)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-md)",
    fontSize: "0.85rem",
    boxSizing: "border-box",
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "编辑用途配置" : "添加用途配置"}>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <button
          onClick={switchToForm}
          style={{
            padding: "var(--space-1) var(--space-3)",
            border: mode === "form" ? "2px solid var(--color-primary)" : "2px solid var(--border-color)",
            background: "none",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            fontWeight: mode === "form" ? 600 : 400,
            marginRight: 8,
          }}
        >
          表单视图
        </button>
        <button
          onClick={switchToJson}
          style={{
            padding: "var(--space-1) var(--space-3)",
            border: mode === "json" ? "2px solid var(--color-primary)" : "2px solid var(--border-color)",
            background: "none",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            fontWeight: mode === "json" ? 600 : 400,
          }}
        >
          JSON 视图
        </button>
      </div>

      {mode === "form" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {!isEdit && (
            <label>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>快速预设</div>
              <select value={preset} onChange={(e) => applyPreset(e.target.value)} style={inputStyle}>
                <option value="">自定义...</option>
                {MODEL_PRESETS.map((p) => (
                  <option key={p.model} value={p.model}>
                    {p.label} — {p.base_url}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>密钥凭证</div>
            <select value={form.secret_id} onChange={(e) => updateField("secret_id", e.target.value)} style={inputStyle}>
              <option value="">选择...</option>
              {secrets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} (sk-...{s.key_suffix})
                </option>
              ))}
              {!secretsLoaded && (
                <option value="" disabled>
                  加载中...
                </option>
              )}
            </select>
            {!secretsLoaded && secrets.length === 0 && (
              <div style={{ fontSize: "0.75rem", color: "var(--amber-600)", marginTop: 4 }}>未找到密钥凭证，请先在"密钥凭证"标签页添加</div>
            )}
          </label>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>配置标签</div>
            <input value={form.label} onChange={(e) => updateField("label", e.target.value)} placeholder="如: QA用Pro模型" style={inputStyle} />
          </label>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>Base URL</div>
            <input value={form.base_url} onChange={(e) => updateField("base_url", e.target.value)} placeholder="https://api.deepseek.com" style={inputStyle} />
          </label>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>模型</div>
              <input value={form.model} onChange={(e) => updateField("model", e.target.value)} placeholder="deepseek-v4-pro" style={inputStyle} />
            </label>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>用途</div>
              <select value={form.purpose} onChange={(e) => updateField("purpose", e.target.value)} style={inputStyle}>
                {PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>优先级 (越小越优先)</div>
              <input type="number" value={form.priority} onChange={(e) => updateField("priority", parseInt(e.target.value, 10) || 10)} style={inputStyle} />
            </label>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>月度费用上限 (¥)</div>
              <input
                type="number"
                step="0.01"
                value={form.monthly_cost_limit}
                onChange={(e) => updateField("monthly_cost_limit", e.target.value)}
                placeholder="不限"
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>入价/百万token</div>
              <input
                type="number"
                step="0.01"
                value={form.price_input_per_1m}
                onChange={(e) => updateField("price_input_per_1m", parseFloat(e.target.value) || 0)}
                style={inputStyle}
              />
            </label>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>出价/百万token</div>
              <input
                type="number"
                step="0.01"
                value={form.price_output_per_1m}
                onChange={(e) => updateField("price_output_per_1m", parseFloat(e.target.value) || 0)}
                style={inputStyle}
              />
            </label>
          </div>
        </div>
      ) : (
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          style={{
            width: "100%",
            height: 360,
            padding: "var(--space-3)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
            fontSize: "0.8rem",
            fontFamily: "monospace",
            boxSizing: "border-box",
            resize: "vertical",
          }}
          placeholder='{"secret_id":1,"label":"...","base_url":"...","model":"...","purpose":"qa","priority":10}'
        />
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <button onClick={onClose} className="btn btn-secondary">
          取消
        </button>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </Modal>
  );
}
