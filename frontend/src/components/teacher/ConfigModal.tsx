import { useEffect, useState } from "react";
import { createConfig, fetchSecrets, updateConfig } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type LLMConfigResponse = components["schemas"]["LLMConfigResponse"];

interface ConfigModalProps {
  open: boolean;
  configData: LLMConfigResponse | null;
  prefilled?: { secret_id?: number; purpose?: string; model?: string } | null;
  onClose: () => void;
  onSaved: () => void;
}

const PURPOSE_QUICK = [
  { purpose: "scoring", label: "评分", desc: "DeepSeek Pro — 高精度评分", model: "deepseek-v4-pro", icon: "📊" },
  { purpose: "patient_chat", label: "患者对话", desc: "DeepSeek Flash — 快速响应", model: "deepseek-v4-flash", icon: "💬" },
  { purpose: "qa", label: "问答", desc: "DeepSeek Flash — 通用问答", model: "deepseek-v4-flash", icon: "❓" },
  { purpose: "case_generation", label: "病例生成", desc: "DeepSeek Flash — 生成病例", model: "deepseek-v4-flash", icon: "📋" },
  { purpose: "*", label: "通配兜底", desc: "DeepSeek Flash — 其他用途后备", model: "deepseek-v4-flash", icon: "🔄" },
];

const ALL_PURPOSES = [
  { value: "*", label: "通配 (全部)" },
  { value: "qa", label: "问答 (QA)" },
  { value: "patient_chat", label: "患者对话" },
  { value: "scoring", label: "评分" },
  { value: "case_generation", label: "病例生成" },
];

const inputClass =
  "w-full px-3 py-2 border border-border rounded-md text-sm bg-card focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10";

export default function ConfigModal({ open, configData, prefilled, onClose, onSaved }: ConfigModalProps) {
  const [secrets, setSecrets] = useState<ApiSecretResponse[]>([]);
  const [secretId, setSecretId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const isEdit = configData != null;

  const [label, setLabel] = useState("");
  const [model, setModel] = useState("");
  const [purpose, setPurpose] = useState("qa");
  const [priority, setPriority] = useState(10);
  const [weight, setWeight] = useState(10);
  const [priceIn, setPriceIn] = useState(1);
  const [priceOut, setPriceOut] = useState(2);
  const [monthlyLimit, setMonthlyLimit] = useState("");

  const selectedSecret = secrets.find((s) => String(s.id) === secretId);
  const autoKey = secrets.length === 1 ? String(secrets[0].id) : "";

  useEffect(() => {
    if (open) {
      fetchSecrets()
        .then(({ data }) => setSecrets(data))
        .catch(() => {});
      if (configData) {
        setSecretId(String(configData.secret_id || ""));
        setLabel(configData.label || "");
        setModel(configData.model || "");
        setPurpose(configData.purpose || "qa");
        setPriority(configData.priority || 10);
        setWeight(configData.weight || 10);
        setPriceIn(configData.price_input_per_1m ?? 1);
        setPriceOut(configData.price_output_per_1m ?? 2);
        setMonthlyLimit(configData.monthly_cost_limit != null ? String(configData.monthly_cost_limit) : "");
        setShowAdvanced(true);
      } else if (prefilled) {
        setSecretId(String(prefilled.secret_id || autoKey || ""));
        setModel(prefilled.model || "");
        setPurpose(prefilled.purpose || "qa");
        setPriority(10);
        setWeight(10);
        setPriceIn(1);
        setPriceOut(2);
        setMonthlyLimit("");
        setShowAdvanced(false);
      } else {
        setSecretId(autoKey);
        setLabel("");
        setModel("");
        setPurpose("qa");
        setPriority(10);
        setWeight(10);
        setPriceIn(1);
        setPriceOut(2);
        setMonthlyLimit("");
        setShowAdvanced(false);
      }
    }
  }, [open, configData, prefilled, autoKey]);

  const handleQuickCreate = async (purposeVal: string, modelVal: string) => {
    const sid = secretId || autoKey;
    if (!sid) {
      error("请先添加 API 密钥");
      return;
    }
    setSaving(true);
    try {
      await createConfig({
        secret_id: Number(sid),
        label: `${selectedSecret?.label || "key"}-${purposeVal}`,
        model: modelVal,
        purpose: purposeVal,
        priority: 10,
        weight: 10,
        price_input_per_1m: modelVal.includes("pro") ? 1 : 0.5,
        price_output_per_1m: modelVal.includes("pro") ? 2 : 0.5,
      });
      success("已创建");
      onSaved();
      onClose();
    } catch (e: any) {
      error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const payload = {
      secret_id: Number(secretId),
      label: label || `${selectedSecret?.label || ""}-${purpose}`,
      model,
      purpose,
      priority,
      weight,
      price_input_per_1m: priceIn,
      price_output_per_1m: priceOut,
      monthly_cost_limit: monthlyLimit ? Number(monthlyLimit) : undefined,
    };
    if (!payload.secret_id) {
      error("请选择密钥");
      return;
    }
    if (!payload.model) {
      error("请填写模型");
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
    } catch (e: any) {
      error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "编辑绑定" : "添加用途绑定"}>
      <div className="mb-3">
        <div className="mb-1 font-semibold text-sm">选择密钥</div>
        <select value={secretId} onChange={(e) => setSecretId(e.target.value)} className={inputClass}>
          <option value="">选择密钥...</option>
          {secrets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} (sk-...{s.key_suffix})
            </option>
          ))}
        </select>
        {selectedSecret && (
          <div className="text-[0.72rem] text-muted-foreground/70 mt-0.5">
            {selectedSecret.provider || "custom"} · {selectedSecret.base_url || ""}
          </div>
        )}
      </div>

      {!isEdit && !showAdvanced ? (
        <div>
          <div className="mb-2 text-sm font-semibold text-muted-foreground">快速创建 — 点击卡片一键配置</div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {PURPOSE_QUICK.map((p) => (
              <button
                key={p.purpose}
                onClick={() => handleQuickCreate(p.purpose, p.model)}
                disabled={saving || !(secretId || autoKey)}
                className="p-3 rounded-md border border-border bg-card cursor-pointer text-left flex flex-col gap-0.5 hover:bg-muted disabled:opacity-50"
              >
                <span className="text-lg">{p.icon}</span>
                <span className="font-semibold text-sm">{p.label}</span>
                <span className="text-[0.7rem] text-muted-foreground/70">{p.desc}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowAdvanced(true)}
            className="bg-transparent border-none text-muted-foreground/70 cursor-pointer text-xs p-0 hover:underline"
          >
            高级模式 → 自定义优先级/权重/定价
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {!isEdit && (
            <button
              onClick={() => setShowAdvanced(false)}
              className="bg-transparent border-none text-muted-foreground/70 cursor-pointer text-xs p-0 text-left hover:underline"
            >
              ← 返回快速创建
            </button>
          )}
          <label>
            <div className="mb-1 font-semibold text-sm">配置标签</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如: QA用Pro" className={inputClass} />
          </label>
          <div>
            <div className="mb-1 font-semibold text-sm">模型</div>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-pro" className={inputClass} />
          </div>
          <div className="flex gap-3">
            <label className="flex-1">
              <div className="mb-1 font-semibold text-sm">用途</div>
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputClass}>
                {ALL_PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1">
              <div className="mb-1 font-semibold text-sm">优先级</div>
              <input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value, 10) || 10)} className={inputClass} />
            </label>
          </div>
          <div className="flex gap-3">
            <label className="flex-1">
              <div className="mb-1 font-semibold text-sm">权重</div>
              <input
                type="number"
                min={1}
                max={100}
                value={weight}
                onChange={(e) => setWeight(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 10)))}
                className={inputClass}
              />
            </label>
            <label className="flex-1">
              <div className="mb-1 font-semibold text-sm">月度上限 (¥)</div>
              <input
                type="number"
                step="0.01"
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value)}
                placeholder="不限"
                className={inputClass}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <label className="flex-1">
              <div className="mb-1 font-semibold text-sm">入价/百万token</div>
              <input type="number" step="0.01" value={priceIn} onChange={(e) => setPriceIn(parseFloat(e.target.value) || 0)} className={inputClass} />
            </label>
            <label className="flex-1">
              <div className="mb-1 font-semibold text-sm">出价/百万token</div>
              <input type="number" step="0.01" value={priceOut} onChange={(e) => setPriceOut(parseFloat(e.target.value) || 0)} className={inputClass} />
            </label>
          </div>
        </div>
      )}

      {(isEdit || showAdvanced) && (
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
