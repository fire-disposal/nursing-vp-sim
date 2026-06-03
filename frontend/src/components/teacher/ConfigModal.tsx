import { useCallback, useEffect, useState } from "react";
import { createConfig, fetchModelPresets, fetchSecrets, type ModelPresetItem, updateConfig } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Modal from "@/components/ui/Modal";

type Schemas = components["schemas"];
type ApiSecretResponse = Schemas["ApiSecretResponse"];
type LLMConfigResponse = Schemas["LLMConfigResponse"];

interface ConfigModalProps {
  open: boolean;
  configData: LLMConfigResponse | null;
  onClose: () => void;
  onSaved: () => void;
}

const PURPOSES = [
  { value: "*", label: "通配 (全部)" },
  { value: "qa", label: "问答 (QA)" },
  { value: "patient_chat", label: "患者对话" },
  { value: "scoring", label: "评分" },
  { value: "case_generation", label: "病例生成" },
];

interface ConfigForm {
  secret_id: string;
  label: string;
  model: string;
  purpose: string;
  priority: number;
  weight: number;
  price_input_per_1m: number;
  price_output_per_1m: number;
  monthly_cost_limit: string;
}

export default function ConfigModal({ open, configData, onClose, onSaved }: ConfigModalProps) {
  const [secrets, setSecrets] = useState<ApiSecretResponse[]>([]);
  const [modelPresets, setModelPresets] = useState<ModelPresetItem[]>([]);
  const [secretsLoaded, setSecretsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const isEdit = configData != null;

  const newFormDefaults = useCallback((): ConfigForm => {
    const sid = secrets.length > 0 ? String(secrets[0].id) : "";
    return {
      secret_id: sid,
      label: "",
      model: "",
      purpose: "qa",
      priority: 10,
      weight: 10,
      price_input_per_1m: 1,
      price_output_per_1m: 2,
      monthly_cost_limit: "",
    };
  }, [secrets]);

  const [form, setForm] = useState<ConfigForm>(newFormDefaults());
  const [customModel, setCustomModel] = useState(false);
  const selectedSecret = secrets.find((s) => String(s.id) === form.secret_id);

  const loadModelPresets = (baseUrl: string) => {
    if (!baseUrl) {
      setModelPresets([]);
      return;
    }
    fetchModelPresets()
      .then(({ data }) => {
        for (const p of data.providers) {
          if (p.base_url && baseUrl.startsWith(p.base_url)) {
            setModelPresets(p.models);
            return;
          }
        }
        setModelPresets([]);
      })
      .catch(() => setModelPresets([]));
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
        setForm({
          secret_id: String(configData.secret_id || ""),
          label: configData.label || "",
          model: configData.model || "",
          purpose: configData.purpose || "qa",
          priority: configData.priority || 10,
          weight: (configData as any).weight || 10,
          price_input_per_1m: configData.price_input_per_1m ?? 1,
          price_output_per_1m: configData.price_output_per_1m ?? 2,
          monthly_cost_limit: configData.monthly_cost_limit != null ? String(configData.monthly_cost_limit) : "",
        });
      } else {
        setForm(newFormDefaults());
        setCustomModel(false);
      }
    }
  }, [open, configData, newFormDefaults]);

  const updateField = <K extends keyof ConfigForm>(name: K, value: ConfigForm[K]) => {
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "secret_id") {
        const s = secrets.find((x) => String(x.id) === String(value)) as any;
        if (s?.base_url) loadModelPresets(s.base_url);
        setCustomModel(false);
      }
      return next;
    });
  };

  const handleModelSelect = (modelName: string) => {
    updateField("model", modelName);
    const preset = modelPresets.find((m) => m.name === modelName);
    if (preset) {
      updateField("price_input_per_1m", preset.price_input);
      updateField("price_output_per_1m", preset.price_output);
    }
  };

  const handleSave = async () => {
    const payload = {
      secret_id: Number(form.secret_id),
      label: form.label || `${selectedSecret?.label || ""}-${form.purpose}`,
      model: form.model,
      purpose: form.purpose,
      priority: form.priority || 10,
      weight: form.weight || 10,
      price_input_per_1m: form.price_input_per_1m || 0,
      price_output_per_1m: form.price_output_per_1m || 0,
      monthly_cost_limit: form.monthly_cost_limit ? Number(form.monthly_cost_limit) : undefined,
    } as any;
    if (!payload.secret_id) {
      error("请选择密钥凭证");
      return;
    }
    if (!payload.model) {
      error("请填写模型名");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateConfig(configData.id, payload);
        success("已更新");
      } else {
        await createConfig(payload);
        success("已创建");
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: unknown } }; message?: string };
      error(typeof err.response?.data?.detail === "string" ? err.response.data.detail : `保存失败`);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "var(--space-2) var(--space-3)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-md)",
    fontSize: "0.85rem",
    boxSizing: "border-box",
  } as const;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "编辑用途配置" : "添加用途配置"}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <label>
          <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>密钥凭证</div>
          <select value={form.secret_id} onChange={(e) => updateField("secret_id", e.target.value)} style={inputStyle}>
            <option value="">选择...</option>
            {secrets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} (sk-...{s.key_suffix})
              </option>
            ))}
            {!secretsLoaded && <option disabled>加载中...</option>}
          </select>
        </label>
        {selectedSecret && (
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              padding: "var(--space-2)",
              background: "var(--bg-surface-subtle)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <span style={{ fontWeight: 600 }}>{(selectedSecret as any).provider || selectedSecret.label}</span>
            {" · "}
            {(selectedSecret as any).base_url || "(未设置端点)"}
          </div>
        )}
        <label>
          <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>配置标签</div>
          <input value={form.label} onChange={(e) => updateField("label", e.target.value)} placeholder="如: QA用Pro模型" style={inputStyle} />
        </label>
        <div>
          <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>模型</div>
          {!customModel && modelPresets.length > 0 ? (
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <select value={form.model} onChange={(e) => handleModelSelect(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                <option value="">选择模型...</option>
                {modelPresets.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} (入 ¥{m.price_input}/出 ¥{m.price_output})
                  </option>
                ))}
              </select>
              <button
                onClick={() => setCustomModel(true)}
                style={{
                  padding: "var(--space-1) var(--space-2)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-color)",
                  background: "none",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  whiteSpace: "nowrap",
                }}
              >
                自定义
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <input value={form.model} onChange={(e) => updateField("model", e.target.value)} placeholder="如: deepseek-v4-pro" style={inputStyle} />
              {modelPresets.length > 0 && (
                <button
                  onClick={() => setCustomModel(false)}
                  style={{
                    padding: "var(--space-1) var(--space-2)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-color)",
                    background: "none",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  预设
                </button>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
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
          <label style={{ flex: 1 }}>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>优先级</div>
            <input type="number" value={form.priority} onChange={(e) => updateField("priority", parseInt(e.target.value, 10) || 10)} style={inputStyle} />
          </label>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          <label style={{ flex: 1 }}>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>权重 (1-100)</div>
            <input
              type="number"
              min={1}
              max={100}
              value={form.weight}
              onChange={(e) => updateField("weight", Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 10)))}
              style={inputStyle}
            />
          </label>
          <label style={{ flex: 1 }}>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>月度上限 (¥)</div>
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
