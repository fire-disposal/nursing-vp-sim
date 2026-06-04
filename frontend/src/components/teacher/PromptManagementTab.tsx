import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, ChevronDown, ChevronRight, Eye, Hash, Layers, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  activatePrompt,
  createPrompt,
  deletePrompt,
  fetchPrompts,
  fetchSampleVars,
  previewActivePrompt,
  reloadPrompts,
  updatePrompt,
  validatePrompt,
} from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";

type Schemas = components["schemas"];
type PromptTemplateResponse = Schemas["PromptTemplateResponse"];
type PromptPreviewResponse = Schemas["PromptPreviewResponse"];
type PromptValidateResponse = Schemas["PromptValidateResponse"];

const PURPOSES = ["patient_chat", "scoring", "qa", "case_generation", "*"];
const PURPOSE_LABELS: Record<string, string> = { patient_chat: "患者对话", scoring: "评分", qa: "问答", case_generation: "病例生成", "*": "通配" };

interface VariableMeta {
  name: string;
  type?: string;
  desc?: string;
  source?: string;
  example?: string;
  default_value?: string;
}

interface VariableCardProps {
  vName: string;
  meta: VariableMeta;
  onUpdateDesc: (vName: string, desc: string) => void;
  onUpdateDefault: (vName: string, defaultValue: string) => void;
  onUpdateSource: (vName: string, source: string) => void;
}

const VariableCard = ({ vName, meta, onUpdateDesc, onUpdateDefault, onUpdateSource }: VariableCardProps) => {
  const [editing, setEditing] = useState(false);
  const [descDraft, setDescDraft] = useState(meta.desc || "");
  const [editingDefault, setEditingDefault] = useState(false);
  const [defaultDraft, setDefaultDraft] = useState(meta.default_value || "");
  const [editingSource, setEditingSource] = useState(false);
  const [sourceDraft, setSourceDraft] = useState(meta.source || "");

  const isSystem =
    meta.source &&
    (meta.source.includes("病例数据") ||
      meta.source.includes("运行时") ||
      meta.source.includes("prompt_static") ||
      meta.source.includes("自动生成") ||
      meta.source.includes("Message 表"));

  const commitDesc = () => {
    setEditing(false);
    if (descDraft !== (meta.desc || "")) {
      onUpdateDesc(vName, descDraft);
    }
  };

  const commitDefault = () => {
    setEditingDefault(false);
    if (defaultDraft !== (meta.default_value || "")) {
      onUpdateDefault(vName, defaultDraft);
    }
  };

  const commitSource = () => {
    setEditingSource(false);
    if (sourceDraft !== (meta.source || "")) {
      onUpdateSource(vName, sourceDraft);
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-2 bg-gray-50">
      <div className="flex items-center justify-between mb-1">
        <code className="text-sm font-semibold text-blue-700">
          {"{#}"}
          {vName}
          {"#}"}
        </code>
        <div className="flex items-center gap-1">
          {isSystem && <span className="text-[0.625rem] bg-amber-100 text-amber-700 px-1 rounded-full leading-[17px] whitespace-nowrap">系统注入</span>}
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 rounded-full">{meta.type || "string"}</span>
        </div>
      </div>

      {editing ? (
        <div className="mb-1">
          <input
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDesc();
            }}
            autoFocus
            placeholder="变量描述..."
            className="w-full text-xs py-0.5 px-1.5 border border-blue-300 rounded outline-none"
          />
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          className={`text-xs mb-1 cursor-pointer py-0.5 ${meta.desc ? "text-gray-500 not-italic" : "text-gray-400 italic"}`}
          title="点击编辑描述"
        >
          {meta.desc || "点击添加描述..."}
        </div>
      )}

      <div className="text-xs text-gray-400 leading-relaxed">
        {editingSource ? (
          <div className="mb-0.5">
            <input
              value={sourceDraft}
              onChange={(e) => setSourceDraft(e.target.value)}
              onBlur={commitSource}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSource();
              }}
              autoFocus
              placeholder="变量来源..."
              className="w-full text-xs py-0.5 px-1.5 border border-amber-300 rounded outline-none"
            />
          </div>
        ) : (
          <div
            onClick={() => setEditingSource(true)}
            className={`cursor-pointer ${meta.source ? "text-gray-500 not-italic" : "text-gray-400 italic"}`}
            title="点击编辑来源说明"
          >
            {meta.source ? `来源：${meta.source}` : "点击添加来源说明..."}
          </div>
        )}
        {meta.example && <div className="whitespace-pre-wrap max-h-[60px] overflow-hidden">示例：{meta.example}</div>}
        <div className="mt-0.5">
          {isSystem ? (
            <div className="text-xs text-gray-400 italic">默认值：由系统运行时注入，不可编辑</div>
          ) : editingDefault ? (
            <input
              value={defaultDraft}
              onChange={(e) => setDefaultDraft(e.target.value)}
              onBlur={commitDefault}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDefault();
              }}
              autoFocus
              placeholder="默认值..."
              className="w-full text-xs py-0.5 px-1.5 border border-green-300 rounded outline-none"
            />
          ) : (
            <div
              onClick={() => setEditingDefault(true)}
              className={`cursor-pointer ${meta.default_value ? "text-gray-500 not-italic" : "text-gray-400 italic"}`}
              title="点击设置默认值（自定义变量在调用点未提供值时使用）"
            >
              默认值：{meta.default_value || "(点击设置)"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface PromptForm {
  purpose: string;
  name: string;
  system_prompt: string;
  user_prompt: string;
  remark: string;
  activate: boolean;
}

export default function PromptManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const { data: prompts = [] } = useQuery({
    queryKey: ["prompts"],
    queryFn: () => fetchPrompts(undefined).then((r) => r.data),
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<PromptForm>({ purpose: "patient_chat", name: "", system_prompt: "", user_prompt: "", remark: "", activate: true });
  const [validation, setValidation] = useState<PromptValidateResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [showActiveModal, setShowActiveModal] = useState(false);
  const [activeModalPurpose, setActiveModalPurpose] = useState("patient_chat");
  const [previewData, setPreviewData] = useState<PromptPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showRendered, setShowRendered] = useState(true);
  const [showEditorPreview, setShowEditorPreview] = useState(false);
  const [savedForm, setSavedForm] = useState<PromptForm | null>(null);
  const [sampleVars, setSampleVars] = useState<Record<string, Record<string, string>>>({});

  const togglePreview = () => {
    if (!showEditorPreview) {
      setSavedForm({ ...form });
      const vars = sampleVars[form.purpose] || {};
      try {
        const sp = form.system_prompt.replace(/\{#([^}#]+)#\}/g, (_, key) => vars[key.trim()] ?? `{${key}}`);
        const up = form.user_prompt ? form.user_prompt.replace(/\{#([^}#]+)#\}/g, (_, key) => vars[key.trim()] ?? `{${key}}`) : form.user_prompt;
        setForm((f) => ({ ...f, system_prompt: sp, user_prompt: up }));
      } catch {
        /* ignore */
      }
    } else if (savedForm) {
      setForm({ ...savedForm });
      setSavedForm(null);
    }
    setShowEditorPreview((v) => !v);
  };

  const openNew = (purpose: string) => {
    setEditing("new");
    setForm({ purpose, name: "", system_prompt: "", user_prompt: purpose === "scoring" ? "" : "", remark: "", activate: true });
    setValidation(null);
    fetchSampleVars(purpose)
      .then(({ data }) => setSampleVars((s) => ({ ...s, [purpose]: (data as { vars: Record<string, string> }).vars })))
      .catch(() => {});
  };
  const openEdit = (p: PromptTemplateResponse) => {
    setEditing(p.id);
    setForm({
      purpose: p.purpose,
      name: p.name || "",
      system_prompt: p.system_prompt,
      user_prompt: p.user_prompt || "",
      remark: p.remark || "",
      activate: false,
    });
    setValidation(null);
    if (!sampleVars[p.purpose]) {
      fetchSampleVars(p.purpose)
        .then(({ data }) => setSampleVars((s) => ({ ...s, [p.purpose]: (data as { vars: Record<string, string> }).vars })))
        .catch(() => {});
    }
  };

  useEffect(() => {
    if (!editing) setValidation(null);
  }, [editing]);

  const grouped: Record<string, PromptTemplateResponse[]> = {};
  PURPOSES.forEach((p) => {
    grouped[p] = prompts.filter((t) => t.purpose === p).sort((a, b) => b.version - a.version);
  });

  const toggle = (p: string) => setExpanded((e) => ({ ...e, [p]: !e[p] }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing && editing !== "new") {
        await updatePrompt(editing, { name: form.name, system_prompt: form.system_prompt, user_prompt: form.user_prompt || null, remark: form.remark });
        toast.success("已保存");
      } else {
        await createPrompt(form);
        toast.success("已创建");
      }
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } } };
      const detail = e.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? (detail as { msg?: string; type?: string }[]).map((d) => d.msg || d.type || "未知错误").join("; ")
        : detail || "保存失败";
      toast.error(msg as string);
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (p: PromptTemplateResponse) => {
    const ok = await confirm({ title: "切换版本", message: `「${PURPOSE_LABELS[p.purpose]}」切换到 v${p.version} "${p.name || ""}"？`, confirmText: "切换" });
    if (!ok) return;
    try {
      await activatePrompt(p.id);
      toast.success(`已切换到 v${p.version}`);
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } } };
      const d = e.response?.data?.detail;
      toast.error(Array.isArray(d) ? (d as { msg?: string }[]).map((i) => i.msg).join("; ") : (d as string) || "激活失败");
    }
  };

  const handleDelete = async (p: PromptTemplateResponse) => {
    if (p.is_active) {
      toast.error("不能删除当前激活的版本");
      return;
    }
    const ok = await confirm({ title: "删除", message: `删除「${PURPOSE_LABELS[p.purpose]}」v${p.version}?`, confirmText: "删除", danger: true });
    if (!ok) return;
    try {
      await deletePrompt(p.id);
      if (editing === p.id) setEditing(null);
      toast.success("已删除");
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "删除失败");
    }
  };

  const editedPrompt = editing && editing !== "new" ? prompts.find((p) => p.id === editing) : null;

  const handleUpdateVarDesc = (varName: string, newDesc: string) => {
    if (!editedPrompt) return;
    queryClient.setQueryData<PromptTemplateResponse[]>(["prompts"], (prev) =>
      (prev ?? []).map((p) => {
        if (p.id !== editedPrompt.id) return p;
        const updatedVars = ((p.variables || []) as VariableMeta[]).map((v) => (v.name === varName ? { ...v, desc: newDesc } : v));
        if (!updatedVars.find((v) => v.name === varName)) {
          updatedVars.push({ name: varName, desc: newDesc });
        }
        return { ...p, variables: updatedVars as unknown[] };
      }),
    );
  };

  const handleUpdateVarDefault = (varName: string, newDefault: string) => {
    if (!editedPrompt) return;
    queryClient.setQueryData<PromptTemplateResponse[]>(["prompts"], (prev) =>
      (prev ?? []).map((p) => {
        if (p.id !== editedPrompt.id) return p;
        const updatedVars = ((p.variables || []) as VariableMeta[]).map((v) => (v.name === varName ? { ...v, default_value: newDefault } : v));
        if (!updatedVars.find((v) => v.name === varName)) {
          updatedVars.push({ name: varName, default_value: newDefault });
        }
        return { ...p, variables: updatedVars as unknown[] };
      }),
    );
  };

  const handleUpdateVarSource = (varName: string, newSource: string) => {
    if (!editedPrompt) return;
    queryClient.setQueryData<PromptTemplateResponse[]>(["prompts"], (prev) =>
      (prev ?? []).map((p) => {
        if (p.id !== editedPrompt.id) return p;
        const updatedVars = ((p.variables || []) as VariableMeta[]).map((v) => (v.name === varName ? { ...v, source: newSource } : v));
        if (!updatedVars.find((v) => v.name === varName)) {
          updatedVars.push({ name: varName, source: newSource });
        }
        return { ...p, variables: updatedVars as unknown[] };
      }),
    );
  };

  const handleValidate = async () => {
    try {
      const { data } = await validatePrompt({ system_prompt: form.system_prompt, user_prompt: form.user_prompt || null, purpose: form.purpose });
      setValidation(data);
    } catch {
      toast.error("校验失败");
    }
  };

  const handleReload = async () => {
    try {
      await reloadPrompts();
      toast.success("模板已热加载");
    } catch {
      toast.error("热加载失败");
    }
  };

  const handleShowActive = async () => {
    setActiveModalPurpose("patient_chat");
    setShowRendered(true);
    setShowActiveModal(true);
    setPreviewLoading(true);
    try {
      const { data } = await previewActivePrompt("patient_chat");
      setPreviewData(data);
    } catch {
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleActiveModalPurposeChange = async (p: string) => {
    setActiveModalPurpose(p);
    setShowRendered(true);
    setPreviewLoading(true);
    try {
      const { data } = await previewActivePrompt(p);
      setPreviewData(data);
    } catch {
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const editorTitle =
    editing === "new"
      ? `新建「${PURPOSE_LABELS[form.purpose]}」`
      : editing
        ? (() => {
            const t = prompts.find((p) => p.id === editing);
            return t ? `编辑「${PURPOSE_LABELS[t.purpose]}」v${t.version}` : "编辑";
          })()
        : null;

  const extractVars = (text: string) => [...new Set((text.match(/\{#([^}#]+)#\}/g) || []).map((v) => v.slice(2, -2)))];
  const currentVars = useMemo(() => extractVars(form.system_prompt + (form.user_prompt || "")), [form.system_prompt, form.user_prompt, extractVars]);
  const dbVars = (editedPrompt?.variables as VariableMeta[]) || [];

  const renderHighlighted = (text: string | null) => {
    if (!text) return text;
    const parts = text.split(/(\{#[^}#]+#\})/g);
    return parts.map((part, i) =>
      /\{#[^}#]+#\}/.test(part) ? (
        <span key={i} className="bg-blue-100 text-blue-700 font-bold rounded px-0.5">
          {part}
        </span>
      ) : (
        part
      ),
    );
  };

  const inputBase =
    "w-full py-1 px-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-900 font-[inherit] box-border focus:outline-none focus:border-blue-500";

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          onClick={handleReload}
          className="flex items-center gap-1 py-2 px-4 border border-amber-400 rounded-lg bg-amber-50 text-amber-700 cursor-pointer text-sm font-semibold"
        >
          <RefreshCw size={13} /> 热加载
        </button>
        <button
          onClick={handleShowActive}
          className="flex items-center gap-1 py-2 px-4 border border-blue-600 rounded-lg bg-white text-blue-600 cursor-pointer text-sm font-semibold"
        >
          <Eye size={13} /> 查看生效版本
        </button>
      </div>

      <div className="grid grid-cols-[340px_1fr] gap-4 items-start min-h-[calc(100vh-180px)]">
        <div className="rounded-xl border border-gray-200 bg-white p-0 overflow-hidden">
          {PURPOSES.map((purpose) => {
            const versions = grouped[purpose] || [];
            const isOpen = expanded[purpose] !== false;
            return (
              <div key={purpose} className="border-b border-gray-200 last:border-b-0">
                <div
                  onClick={() => toggle(purpose)}
                  className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none font-semibold text-sm bg-gray-50 text-gray-900"
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="flex-1">{PURPOSE_LABELS[purpose]}</span>
                  <span className="text-xs text-gray-400 font-normal">
                    {versions.filter((v) => v.is_active).length > 0
                      ? `v${versions.find((v) => v.is_active)!.version} · ${versions.length}个版本`
                      : `${versions.length}个版本`}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openNew(purpose);
                    }}
                    className="bg-blue-50 border border-blue-200 rounded-lg text-blue-600 cursor-pointer px-2 py-0.5 text-xs font-semibold inline-flex items-center gap-0.5"
                    title="新增"
                  >
                    <Plus size={13} /> 新增
                  </button>
                </div>
                {isOpen && (
                  <div>
                    {versions.length === 0 ? (
                      <div className="px-4 py-3 text-gray-400 text-sm">暂无模板</div>
                    ) : (
                      versions.map((v) => (
                        <div
                          key={v.id}
                          onClick={() => openEdit(v)}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            if (!v.is_active) handleActivate(v);
                          }}
                          className={`flex items-center gap-2 px-4 py-2 border-t border-gray-200 cursor-pointer transition-colors ${
                            editing === v.id ? "bg-blue-50" : v.is_active ? "bg-green-50" : "bg-transparent"
                          }`}
                        >
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded-sm bg-white border border-gray-200 min-w-[28px] text-center">
                            v{v.version}
                          </span>
                          <span className="flex-1 text-sm overflow-hidden text-ellipsis whitespace-nowrap">{v.name || "-"}</span>
                          {v.is_active ? (
                            <span className="text-xs px-1.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap inline-flex items-center gap-0.5">
                              <CheckCircle size={10} /> 激活
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">未激活</span>
                          )}
                          <div onClick={(e) => e.stopPropagation()} className="flex gap-0.5">
                            <button onClick={() => handleDelete(v)} className="bg-transparent border-none text-red-400 cursor-pointer p-0.5" title="删除">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {editing && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-3">
              <h4 className="m-0 text-base flex-1">{editorTitle}</h4>
              {editedPrompt && <span className="text-xs text-gray-400">更新于 {new Date(editedPrompt.updated_at).toLocaleString("zh-CN")}</span>}
            </div>

            {editing === "new" && (
              <div className="mb-3">
                <label className="block text-sm font-semibold mb-1">场景</label>
                <select
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  className="w-full py-2 px-3 border border-gray-200 rounded-lg text-sm bg-white text-gray-900"
                >
                  {PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {PURPOSE_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-semibold mb-1">版本名称</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="v2-优化版" className={inputBase} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">备注</label>
                <input
                  value={form.remark}
                  onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                  placeholder="修改说明..."
                  className={inputBase}
                />
              </div>
            </div>
            <div className="flex-1 flex flex-col mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-semibold">System Prompt</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{form.system_prompt.length} 字符</span>
                  <button
                    type="button"
                    onClick={togglePreview}
                    className={`px-2 py-0.5 border border-blue-300 rounded-sm text-xs font-semibold cursor-pointer ${
                      showEditorPreview ? "bg-blue-500 text-white" : "bg-white text-blue-600"
                    }`}
                  >
                    {showEditorPreview ? "编辑" : "预览填充"}
                  </button>
                </div>
              </div>
              <textarea
                value={form.system_prompt}
                onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                readOnly={showEditorPreview}
                className={`flex-1 min-h-[200px] w-full p-2 rounded-lg text-sm font-mono resize-y box-border ${
                  showEditorPreview ? "border border-blue-300 bg-blue-50" : "border border-gray-200 bg-white"
                } text-gray-900`}
              />
            </div>
            {form.purpose === "scoring" && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-semibold">User Prompt Template</label>
                  <span className="text-xs text-gray-400">{(form.user_prompt || "").length} 字符</span>
                </div>
                <textarea
                  value={form.user_prompt}
                  onChange={(e) => setForm((f) => ({ ...f, user_prompt: e.target.value }))}
                  readOnly={showEditorPreview}
                  rows={6}
                  className={`w-full p-2 rounded-lg text-sm font-mono resize-y box-border ${
                    showEditorPreview ? "border border-blue-300 bg-blue-50" : "border border-gray-200 bg-white"
                  } text-gray-900`}
                />
              </div>
            )}
            <div className="mb-3 flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                  <Hash size={12} /> 模板变量 {currentVars.length > 0 && `(${currentVars.length})`}
                </div>
                {currentVars.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {currentVars.map((vName) => {
                      const meta = dbVars.find((d) => d.name === vName) || { name: vName };
                      return (
                        <VariableCard
                          key={vName}
                          vName={vName}
                          meta={meta}
                          onUpdateDesc={handleUpdateVarDesc}
                          onUpdateDefault={handleUpdateVarDefault}
                          onUpdateSource={handleUpdateVarSource}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">无变量（纯静态 prompt）</span>
                )}
              </div>
            </div>
            {validation && (
              <div className={`p-3 rounded-lg mb-3 text-sm ${validation.valid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {validation.valid ? "校验通过" : validation.errors.join("; ")}
                {validation.missing_vars?.length > 0 && <div className="mt-1">变量未声明: {validation.missing_vars.join(", ")}</div>}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleValidate}
                className="flex items-center gap-1 py-2 px-4 border border-gray-200 rounded-lg bg-white text-gray-900 cursor-pointer text-sm"
              >
                <Play size={14} /> 校验语法
              </button>
              {editedPrompt && !editedPrompt.is_active && (
                <button
                  onClick={() => handleActivate(editedPrompt)}
                  className="flex items-center gap-1 py-2 px-4 border border-green-400 rounded-lg bg-green-50 text-green-700 cursor-pointer text-sm font-semibold"
                >
                  <CheckCircle size={14} /> 保存并激活
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving || showEditorPreview}
                className={`py-2 px-4 border-none rounded-lg text-white text-sm ml-auto ${
                  saving || showEditorPreview ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                }`}
                style={{ background: "var(--primary)" }}
              >
                {saving ? "保存中..." : editing === "new" ? "创建版本" : "保存修改"}
              </button>
              <button
                onClick={() => {
                  if (showEditorPreview && savedForm) setForm({ ...savedForm });
                  setShowEditorPreview(false);
                  setSavedForm(null);
                  setEditing(null);
                }}
                className="py-2 px-4 border border-gray-200 rounded-lg bg-white text-gray-500 cursor-pointer text-sm"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {!editing && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 flex flex-col items-center justify-center min-h-[300px]">
            <Layers size={40} className="text-gray-400 opacity-50 mb-4" />
            <div className="text-base font-semibold text-gray-500 mb-1">选择左侧版本进行编辑</div>
            <div className="text-sm text-gray-400 mb-4">
              点击版本名打开编辑器，或点击左侧 <Plus size={12} className="inline align-middle text-blue-600" /> 为场景创建新版本
            </div>
            {!prompts.length && (
              <button
                onClick={() => openNew("patient_chat")}
                className="flex items-center gap-1 py-2 px-6 border-none rounded-lg bg-blue-600 text-white cursor-pointer text-sm font-semibold"
              >
                <Plus size={14} /> 创建第一个版本
              </button>
            )}
          </div>
        )}
      </div>

      <Modal open={showActiveModal} onClose={() => setShowActiveModal(false)} title={null} maxWidth={900}>
        <div className="flex items-center gap-3 mb-4">
          <select
            value={activeModalPurpose}
            onChange={(e) => handleActiveModalPurposeChange(e.target.value)}
            className="py-2 px-3 border border-gray-200 rounded-lg text-sm bg-white text-gray-900 font-semibold"
          >
            {PURPOSES.map((p) => {
              const av = grouped[p]?.find((t) => t.is_active);
              return (
                <option key={p} value={p}>
                  {PURPOSE_LABELS[p]}
                  {av ? ` · v${av.version}` : " · 未激活"}
                </option>
              );
            })}
          </select>
          {previewData && <span className="text-sm text-gray-400">v{previewData.version}</span>}
          {previewData && (
            <div className="ml-auto flex gap-0.5 bg-gray-50 rounded-lg p-0.5">
              <button
                onClick={() => setShowRendered(true)}
                className={`px-3 py-1 border-none rounded-sm text-xs font-semibold cursor-pointer ${
                  showRendered ? "bg-blue-600 text-white" : "bg-transparent text-gray-500"
                }`}
              >
                渲染效果
              </button>
              <button
                onClick={() => setShowRendered(false)}
                className={`px-3 py-1 border-none rounded-sm text-xs font-semibold cursor-pointer ${
                  !showRendered ? "bg-blue-600 text-white" : "bg-transparent text-gray-500"
                }`}
              >
                原始模板
              </button>
            </div>
          )}
        </div>

        {previewLoading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : previewData ? (
          <>
            <div className="mb-3">
              <div className="text-xs font-semibold text-gray-500 mb-1">System Prompt</div>
              <pre className="m-0 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono whitespace-pre-wrap text-gray-900 max-h-[400px] overflow-auto leading-relaxed">
                {showRendered ? previewData.system_prompt_rendered : renderHighlighted(previewData.system_prompt_raw)}
              </pre>
            </div>
            {previewData.user_prompt_raw && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-gray-500 mb-1">User Prompt Template</div>
                <pre className="m-0 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono whitespace-pre-wrap text-gray-900 max-h-[300px] overflow-auto leading-relaxed">
                  {showRendered ? previewData.user_prompt_rendered : renderHighlighted(previewData.user_prompt_raw)}
                </pre>
              </div>
            )}
            {showRendered && previewData.sample_vars && Object.keys(previewData.sample_vars).length > 0 && (
              <div className="text-xs text-gray-400 mt-2">
                预览替换变量:{" "}
                {Object.entries(previewData.sample_vars).map(([k]) => (
                  <code key={k} className="ml-1.5 py-0.5 px-1.5 bg-blue-50 rounded text-xs">
                    {k}
                  </code>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="p-6 text-center text-gray-400">该场景暂未激活任何版本</div>
        )}
      </Modal>
    </div>
  );
}
