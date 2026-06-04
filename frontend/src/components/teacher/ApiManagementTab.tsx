import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Edit3, Plus, RefreshCw, Trash2 } from "lucide-react";
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
  updateConfig,
} from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
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

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-500",
  degraded: "bg-amber-500",
  disabled: "bg-red-400",
};

const selectClass = "py-0.5 px-1.5 border border-border rounded-md text-sm bg-card";

export default function ApiManagementTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [editingSecret, setEditingSecret] = useState<ApiSecretResponse | null>(null);

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
    const items = (configsByPurpose[purpose] || []).sort((a, b) => ((a as any).priority || 0) - ((b as any).priority || 0));
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
      await createConfig({ secret_id: secretId, model, purpose } as any);
      toast.success("已绑定");
      invalidate();
    } catch (e: any) {
      const msg = typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "绑定失败";
      toast.error(msg);
    }
  };

  return (
    <>
      <div className="mb-3 text-xs flex items-center gap-2 text-muted-foreground/60">
        <span className={cn("inline-block w-[6px] h-[6px] rounded-full", envFallback?.available ? "bg-green-400" : "bg-red-400")} />
        <span className="font-mono text-[0.7rem]">env: sk-...{envFallback?.key_suffix || "****"}</span>
        {envFallback?.call_count ? (
          <span>
            {envFallback.call_count}次 · ¥{envFallback.total_cost}
          </span>
        ) : null}
      </div>

      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-semibold text-gray-700">API 档案</h3>
          <button
            onClick={() => {
              setEditingSecret(null);
              setShowSecretModal(true);
            }}
            className="inline-flex items-center gap-1 py-1 px-3 border-none rounded-md bg-primary text-white cursor-pointer text-sm"
          >
            <Plus size={14} /> 新建档案
          </button>
        </div>
        {secrets.length === 0 ? (
          <div className="border border-dashed border-border rounded-md">
            <EmptyState title="暂无档案" description="新建一个 API Key 档案以开始使用" />
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {secrets.map((s) => {
              const provider = (s as any).provider || "custom";
              const myConfigs = configs.filter((c) => c.secret_id === s.id);
              const secStatus = (s as any).status;
              const statusLabel = secStatus === "active" ? "正常" : secStatus === "degraded" ? "熔断" : "关闭";
              const statusColor = secStatus === "active" ? "text-green-600" : secStatus === "degraded" ? "text-amber-600" : "text-red-500";
              return (
                <div key={s.id} className="flex-1 min-w-[240px] max-w-[320px] rounded-lg border border-border bg-card p-3 relative">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className="inline-block px-1.5 rounded-full text-[0.65rem] font-semibold"
                      style={{
                        background: `${PROVIDER_COLORS[provider] || "#999"}18`,
                        color: PROVIDER_COLORS[provider] || "#666",
                      }}
                    >
                      {provider}
                    </span>
                    <span className="font-semibold text-sm">{s.label}</span>
                    <span className={cn("ml-auto text-[0.7rem]", statusColor)}>{statusLabel}</span>
                  </div>
                  <div className="text-[0.68rem] text-muted-foreground">
                    <span className="font-mono">sk-...{s.key_suffix}</span>
                    {(s as any).base_url && <span className="ml-1.5 text-muted-foreground/70">{(s as any).base_url}</span>}
                  </div>
                  <div className="text-[0.68rem] text-muted-foreground/70 mt-0.5">
                    {myConfigs.length} 用途 · 本月 ¥{Number(s.monthly_cost_used || 0).toFixed(2)}
                  </div>
                  <div className="absolute top-1 right-1 flex gap-0.5">
                    <button
                      onClick={() => {
                        setEditingSecret(s);
                        setShowSecretModal(true);
                      }}
                      className="bg-transparent border-none cursor-pointer text-muted-foreground/70 p-0.5"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button onClick={() => handleDeleteSecret(s)} className="bg-transparent border-none cursor-pointer text-red-400 p-0.5">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-semibold text-gray-700">用途指派</h3>
          <button
            onClick={() =>
              reloadRouter()
                .then(() => toast.success("已重载"))
                .catch(() => toast.error("失败"))
            }
            className="inline-flex items-center gap-1 py-1 px-3 border border-border rounded-md bg-muted text-gray-700 cursor-pointer text-sm"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="border border-border rounded-lg overflow-hidden mb-3">
          {PURPOSES.map((p, i) => {
            const cfg = getConfig(p.key);
            const isLast = i === PURPOSES.length - 1;
            return (
              <div key={p.key} className={cn("flex items-center py-2 px-3 gap-3", !isLast && "border-b border-border")}>
                <div className="w-[100px] shrink-0">
                  <div className="font-semibold text-sm">{p.label}</div>
                  <div className="text-[0.65rem] text-muted-foreground/70">{p.desc}</div>
                </div>
                <div className="flex-1 flex items-center gap-2 flex-wrap">
                  {cfg ? (
                    <>
                      <select
                        value={cfg.secret_id}
                        onChange={async (e) => {
                          const newSid = Number(e.target.value);
                          await updateConfig(cfg.id, { secret_id: newSid } as any);
                          invalidate();
                        }}
                        className={selectClass}
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
                          await updateConfig(cfg.id, { model: newModel } as any);
                          invalidate();
                        }}
                        className={cn(selectClass, "font-mono")}
                      >
                        {getModelsForSecret(cfg.secret_id).map((m: any) => (
                          <option key={m.name} value={m.name}>
                            {m.name}
                          </option>
                        ))}
                        {!getModelsForSecret(cfg.secret_id).find((m: any) => m.name === cfg.model) && <option value={cfg.model}>{cfg.model}</option>}
                      </select>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-sm",
                          cfg.status === "active" ? "text-green-700" : cfg.status === "degraded" ? "text-amber-700" : "text-destructive",
                        )}
                      >
                        <span className={cn("inline-block w-[7px] h-[7px] rounded-full", STATUS_DOT[cfg.status] || "bg-gray-400")} />
                        {cfg.status === "active" ? "正常" : cfg.status === "degraded" ? "熔断" : "关闭"}
                      </span>
                      <span className="text-[0.7rem] text-muted-foreground/70">
                        {cfg.status === "active" && (cfg as any).call_count_today ? `${(cfg as any).call_count_today}次` : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground/70">未指派</span>
                  )}
                </div>
                <div className="shrink-0 flex gap-1 items-center">
                  {cfg ? (
                    <>
                      {cfg.status === "degraded" ? (
                        <button onClick={() => handleReset(cfg)} className="bg-transparent border-none cursor-pointer text-amber-500 p-0.5" title="恢复">
                          <RefreshCw size={12} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggle(cfg)}
                          title={cfg.status === "active" ? "停用" : "启用"}
                          className={cn(
                            "bg-transparent border-none cursor-pointer p-0.5 text-xs font-semibold",
                            cfg.status === "active" ? "text-red-400" : "text-green-500",
                          )}
                        >
                          {cfg.status === "active" ? "停" : "启"}
                        </button>
                      )}
                      <button onClick={() => handleTest(cfg)} className="bg-transparent border-none cursor-pointer text-muted-foreground/70 p-0.5" title="测试">
                        <Activity size={12} />
                      </button>
                      <button onClick={() => handleDeleteConfig(cfg)} className="bg-transparent border-none cursor-pointer text-red-400 p-0.5">
                        <Trash2 size={12} />
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-1 items-center">
                      <select
                        onChange={(e) => {
                          const sid = Number(e.target.value);
                          if (!sid) return;
                          const models = getModelsForSecret(sid);
                          handleQuickBind(p.key, sid, models[0]?.name || "deepseek-v4-flash");
                        }}
                        className="py-0.5 px-1.5 border border-border rounded-md text-xs bg-card"
                      >
                        <option value="">选择档案...</option>
                        {secrets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-[0.7rem] text-muted-foreground/70">选择档案即可绑定</span>
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
