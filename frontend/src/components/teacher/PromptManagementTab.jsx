import { CheckCircle, ChevronDown, ChevronRight, Eye, Hash, Layers, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import Modal from "../ui/Modal";

const PURPOSES = ["patient_chat", "scoring", "qa", "case_generation", "*"];
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答", case_generation: "病例生成", "*": "通配" };

const VariableCard = ({ vName, meta, onUpdateDesc, onUpdateDefault, onUpdateSource }) => {
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
    <div
      style={{
        border: "1px solid var(--border-secondary)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-2) var(--space-3)",
        background: "var(--bg-secondary)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <code
          style={{
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--blue-700)",
          }}
        >
          {"{#"}
          {vName}
          {"#}"}
        </code>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {isSystem && (
            <span
              style={{
                fontSize: "0.6rem",
                background: "var(--amber-100)",
                color: "var(--amber-700)",
                padding: "0px 5px",
                borderRadius: "var(--radius-full)",
                lineHeight: "17px",
                whiteSpace: "nowrap",
              }}
            >
              系统注入
            </span>
          )}
          <span
            style={{
              fontSize: "0.65rem",
              color: "var(--text-tertiary)",
              background: "var(--bg-tertiary)",
              padding: "1px 6px",
              borderRadius: "var(--radius-full)",
            }}
          >
            {meta.type || "string"}
          </span>
        </div>
      </div>

      {editing ? (
        <div style={{ marginBottom: 4 }}>
          <input
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDesc();
            }}
            autoFocus
            placeholder="变量描述..."
            style={{
              width: "100%",
              fontSize: "0.72rem",
              padding: "2px 6px",
              border: "1px solid var(--blue-300)",
              borderRadius: 4,
              outline: "none",
            }}
          />
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          style={{
            fontSize: "0.7rem",
            color: meta.desc ? "var(--text-secondary)" : "var(--text-tertiary)",
            marginBottom: 4,
            cursor: "pointer",
            padding: "2px 0",
            fontStyle: meta.desc ? "normal" : "italic",
          }}
          title="点击编辑描述"
        >
          {meta.desc || "点击添加描述..."}
        </div>
      )}

      <div
        style={{
          fontSize: "0.65rem",
          color: "var(--text-tertiary)",
          lineHeight: 1.5,
        }}
      >
        {editingSource ? (
          <div style={{ marginBottom: 2 }}>
            <input
              value={sourceDraft}
              onChange={(e) => setSourceDraft(e.target.value)}
              onBlur={commitSource}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSource();
              }}
              autoFocus
              placeholder="变量来源..."
              style={{
                width: "100%",
                fontSize: "0.68rem",
                padding: "2px 6px",
                border: "1px solid var(--amber-300)",
                borderRadius: 4,
                outline: "none",
              }}
            />
          </div>
        ) : (
          <div
            onClick={() => setEditingSource(true)}
            style={{
              cursor: "pointer",
              color: meta.source ? "var(--text-secondary)" : "var(--text-tertiary)",
              fontStyle: meta.source ? "normal" : "italic",
            }}
            title="点击编辑来源说明"
          >
            {meta.source ? `来源：${meta.source}` : "点击添加来源说明..."}
          </div>
        )}
        {meta.example && (
          <div
            style={{
              whiteSpace: "pre-wrap",
              maxHeight: 60,
              overflow: "hidden",
            }}
          >
            示例：{meta.example}
          </div>
        )}
        <div style={{ marginTop: 2 }}>
          {isSystem ? (
            <div style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>默认值：由系统运行时注入，不可编辑</div>
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
              style={{
                width: "100%",
                fontSize: "0.68rem",
                padding: "2px 6px",
                border: "1px solid var(--green-300)",
                borderRadius: 4,
                outline: "none",
              }}
            />
          ) : (
            <div
              onClick={() => setEditingDefault(true)}
              style={{
                cursor: "pointer",
                color: meta.default_value ? "var(--text-secondary)" : "var(--text-tertiary)",
                fontStyle: meta.default_value ? "normal" : "italic",
              }}
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

export default function PromptManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [prompts, setPrompts] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ purpose: "patient_chat", name: "", system_prompt: "", user_prompt: "", remark: "", activate: true });
  const [validation, setValidation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showActiveModal, setShowActiveModal] = useState(false);
  const [activeModalPurpose, setActiveModalPurpose] = useState("patient_chat");
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showRendered, setShowRendered] = useState(true);
  const [showEditorPreview, setShowEditorPreview] = useState(false);
  const [savedForm, setSavedForm] = useState(null);
  const [sampleVars, setSampleVars] = useState({});

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

  const openNew = (purpose) => {
    setEditing("new");
    setForm({ purpose, name: "", system_prompt: "", user_prompt: purpose === "scoring" ? "" : "", remark: "", activate: true });
    setValidation(null);
    fetchSampleVars(purpose)
      .then(({ data }) => setSampleVars((s) => ({ ...s, [purpose]: data.vars })))
      .catch(() => {});
  };
  const openEdit = (p) => {
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
        .then(({ data }) => setSampleVars((s) => ({ ...s, [p.purpose]: data.vars })))
        .catch(() => {});
    }
  };

  const load = useCallback(() => {
    fetchPrompts(null)
      .then(({ data }) => setPrompts(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!editing) setValidation(null);
  }, [editing]);

  const grouped = {};
  PURPOSES.forEach((p) => {
    grouped[p] = prompts.filter((t) => t.purpose === p).sort((a, b) => b.version - a.version);
  });

  const toggle = (p) => setExpanded((e) => ({ ...e, [p]: !e[p] }));

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
      load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail.map((e) => e.msg || e.type || "未知错误").join("; ") : detail || "保存失败";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (p) => {
    const ok = await confirm({ title: "切换版本", message: `「${PURPOSE_LABELS[p.purpose]}」切换到 v${p.version} "${p.name || ""}"？`, confirmText: "切换" });
    if (!ok) return;
    try {
      await activatePrompt(p.id);
      toast.success(`已切换到 v${p.version}`);
      load();
    } catch (err) {
      const d = err.response?.data?.detail;
      toast.error(Array.isArray(d) ? d.map((e) => e.msg).join("; ") : d || "激活失败");
    }
  };

  const handleDelete = async (p) => {
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
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "删除失败");
    }
  };

  const handleUpdateVarDesc = (varName, newDesc) => {
    if (!editedPrompt) return;
    setPrompts((prev) =>
      prev.map((p) => {
        if (p.id !== editedPrompt.id) return p;
        const updatedVars = (p.variables || []).map((v) => (v.name === varName ? { ...v, desc: newDesc } : v));
        if (!updatedVars.find((v) => v.name === varName)) {
          updatedVars.push({ name: varName, desc: newDesc });
        }
        return { ...p, variables: updatedVars };
      }),
    );
  };

  const handleUpdateVarDefault = (varName, newDefault) => {
    if (!editedPrompt) return;
    setPrompts((prev) =>
      prev.map((p) => {
        if (p.id !== editedPrompt.id) return p;
        const updatedVars = (p.variables || []).map((v) => (v.name === varName ? { ...v, default_value: newDefault } : v));
        if (!updatedVars.find((v) => v.name === varName)) {
          updatedVars.push({ name: varName, default_value: newDefault });
        }
        return { ...p, variables: updatedVars };
      }),
    );
  };

  const handleUpdateVarSource = (varName, newSource) => {
    if (!editedPrompt) return;
    setPrompts((prev) =>
      prev.map((p) => {
        if (p.id !== editedPrompt.id) return p;
        const updatedVars = (p.variables || []).map((v) => (v.name === varName ? { ...v, source: newSource } : v));
        if (!updatedVars.find((v) => v.name === varName)) {
          updatedVars.push({ name: varName, source: newSource });
        }
        return { ...p, variables: updatedVars };
      }),
    );
  };

  const handleValidate = async () => {
    try {
      const { data } = await validatePrompt({ system_prompt: form.system_prompt, user_prompt: form.user_prompt || null });
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

  const handleActiveModalPurposeChange = async (p) => {
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

  const extractVars = (text) => [...new Set((text.match(/\{#([^}#]+)#\}/g) || []).map((v) => v.slice(2, -2)))];
  const currentVars = useMemo(() => extractVars(form.system_prompt + (form.user_prompt || "")), [form.system_prompt, form.user_prompt]);
  const editedPrompt = editing && editing !== "new" ? prompts.find((p) => p.id === editing) : null;
  const dbVars = editedPrompt?.variables || [];

  const renderHighlighted = (text) => {
    if (!text) return text;
    const parts = text.split(/(\{#[^}#]+#\})/g);
    return parts.map((part, i) =>
      /\{#[^}#]+#\}/.test(part) ? (
        <span key={i} style={{ background: "var(--blue-100)", color: "var(--blue-700)", fontWeight: 700, borderRadius: 3, padding: "0 2px" }}>
          {part}
        </span>
      ) : (
        part
      ),
    );
  };

  return (
    <div>
      <div style={{ marginBottom: "var(--space-4)", display: "flex", gap: "var(--space-2)" }}>
        <button
          onClick={handleReload}
          style={{
            padding: "var(--space-2) var(--space-4)",
            border: "1px solid var(--amber-400)",
            borderRadius: "var(--radius-md)",
            background: "var(--amber-50)",
            color: "var(--amber-700)",
            cursor: "pointer",
            fontSize: "0.8rem",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
          }}
        >
          <RefreshCw size={13} /> 热加载
        </button>
        <button
          onClick={handleShowActive}
          style={{
            padding: "var(--space-2) var(--space-4)",
            border: "1px solid var(--color-primary)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-surface)",
            color: "var(--color-primary)",
            cursor: "pointer",
            fontSize: "0.8rem",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
          }}
        >
          <Eye size={13} /> 查看生效版本
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "var(--space-4)", alignItems: "start", minHeight: "calc(100vh - 180px)" }}>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {PURPOSES.map((purpose) => {
            const versions = grouped[purpose] || [];
            const isOpen = expanded[purpose] !== false;
            return (
              <div key={purpose} style={{ borderBottom: "1px solid var(--border-color)" }}>
                <div
                  onClick={() => toggle(purpose)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-3) var(--space-4)",
                    cursor: "pointer",
                    userSelect: "none",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    background: "var(--bg-surface-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span style={{ flex: 1 }}>{PURPOSE_LABELS[purpose]}</span>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", fontWeight: 400 }}>
                    {versions.filter((v) => v.is_active).length > 0
                      ? `v${versions.find((v) => v.is_active).version} · ${versions.length}个版本`
                      : `${versions.length}个版本`}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openNew(purpose);
                    }}
                    style={{
                      background: "var(--blue-50)",
                      border: "1px solid var(--blue-200)",
                      borderRadius: "var(--radius-md)",
                      color: "var(--blue-600)",
                      cursor: "pointer",
                      padding: "2px 8px",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 2,
                    }}
                    title="新增"
                  >
                    <Plus size={13} /> 新增
                  </button>
                </div>
                {isOpen && (
                  <div>
                    {versions.length === 0 ? (
                      <div style={{ padding: "var(--space-3) var(--space-4)", color: "var(--text-tertiary)", fontSize: "0.8rem" }}>暂无模板</div>
                    ) : (
                      versions.map((v) => (
                        <div
                          key={v.id}
                          onClick={() => openEdit(v)}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            if (!v.is_active) handleActivate(v);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-2)",
                            padding: "var(--space-2) var(--space-4)",
                            borderTop: "1px solid var(--border-color)",
                            cursor: "pointer",
                            background: editing === v.id ? "var(--blue-50)" : v.is_active ? "var(--green-50)" : "transparent",
                            transition: "background 0.1s",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              padding: "1px 6px",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--bg-surface)",
                              border: "1px solid var(--border-color)",
                              minWidth: 28,
                              textAlign: "center",
                            }}
                          >
                            v{v.version}
                          </span>
                          <span style={{ flex: 1, fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {v.name || "-"}
                          </span>
                          {v.is_active ? (
                            <span
                              style={{
                                fontSize: "0.65rem",
                                padding: "1px 6px",
                                borderRadius: "var(--radius-full)",
                                background: "var(--green-100)",
                                color: "var(--green-700)",
                                whiteSpace: "nowrap",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 2,
                              }}
                            >
                              <CheckCircle size={10} /> 激活
                            </span>
                          ) : (
                            <span style={{ fontSize: "0.65rem", color: "var(--text-tertiary)" }}>未激活</span>
                          )}
                          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 1 }}>
                            <button
                              onClick={() => handleDelete(v)}
                              style={{ background: "none", border: "none", color: "var(--red-400)", cursor: "pointer", padding: 2 }}
                              title="删除"
                            >
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
          <div className="card" style={{ padding: "var(--space-5)", display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem", flex: 1 }}>{editorTitle}</h4>
              {editedPrompt && (
                <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>更新于 {new Date(editedPrompt.updated_at).toLocaleString("zh-CN")}</span>
              )}
            </div>

            {editing === "new" && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>场景</label>
                <select
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "var(--space-2) var(--space-3)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.85rem",
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                  }}
                >
                  {PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {PURPOSE_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>版本名称</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="v2-优化版"
                  style={{
                    width: "100%",
                    padding: "var(--space-2) var(--space-3)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.85rem",
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>备注</label>
                <input
                  value={form.remark}
                  onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                  placeholder="修改说明..."
                  style={{
                    width: "100%",
                    padding: "var(--space-2) var(--space-3)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.85rem",
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", marginBottom: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>System Prompt</label>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>{form.system_prompt.length} 字符</span>
                  <button
                    type="button"
                    onClick={togglePreview}
                    style={{
                      padding: "1px 8px",
                      border: "1px solid var(--blue-300)",
                      borderRadius: "var(--radius-sm)",
                      background: showEditorPreview ? "var(--blue-500)" : "var(--bg-surface)",
                      color: showEditorPreview ? "#fff" : "var(--blue-600)",
                      cursor: "pointer",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                    }}
                  >
                    {showEditorPreview ? "编辑" : "预览填充"}
                  </button>
                </div>
              </div>
              <textarea
                value={form.system_prompt}
                onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                readOnly={showEditorPreview}
                style={{
                  flex: 1,
                  minHeight: 200,
                  width: "100%",
                  padding: "var(--space-2) var(--space-3)",
                  border: showEditorPreview ? "1px solid var(--blue-300)" : "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "0.8rem",
                  fontFamily: "monospace",
                  background: showEditorPreview ? "var(--blue-25)" : "var(--bg-surface)",
                  color: "var(--text-primary)",
                  boxSizing: "border-box",
                  resize: "vertical",
                }}
              />
            </div>
            {form.purpose === "scoring" && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>User Prompt Template</label>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>{(form.user_prompt || "").length} 字符</span>
                </div>
                <textarea
                  value={form.user_prompt}
                  onChange={(e) => setForm((f) => ({ ...f, user_prompt: e.target.value }))}
                  readOnly={showEditorPreview}
                  rows={6}
                  style={{
                    width: "100%",
                    padding: "var(--space-2) var(--space-3)",
                    border: showEditorPreview ? "1px solid var(--blue-300)" : "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.8rem",
                    fontFamily: "monospace",
                    background: showEditorPreview ? "var(--blue-25)" : "var(--bg-surface)",
                    color: "var(--text-primary)",
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
              </div>
            )}
            <div style={{ marginBottom: "var(--space-3)", display: "flex", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Hash size={12} /> 模板变量 {currentVars.length > 0 && `(${currentVars.length})`}
                </div>
                {currentVars.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {currentVars.map((vName) => {
                      const meta = dbVars.find((d) => d.name === vName) || {};
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
                  <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>无变量（纯静态 prompt）</span>
                )}
              </div>
            </div>
            {validation && (
              <div
                style={{
                  padding: "var(--space-3)",
                  borderRadius: "var(--radius-md)",
                  marginBottom: "var(--space-3)",
                  background: validation.valid ? "var(--green-50)" : "var(--red-50)",
                  color: validation.valid ? "var(--green-700)" : "var(--red-700)",
                  fontSize: "0.8rem",
                }}
              >
                {validation.valid ? "校验通过" : validation.errors.join("; ")}
                {validation.missing_vars?.length > 0 && <div style={{ marginTop: 4 }}>变量未声明: {validation.missing_vars.join(", ")}</div>}
              </div>
            )}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <button
                onClick={handleValidate}
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
                  gap: 4,
                }}
              >
                <Play size={14} /> 校验语法
              </button>
              {editedPrompt && !editedPrompt.is_active && (
                <button
                  onClick={() => handleActivate(editedPrompt)}
                  style={{
                    padding: "var(--space-2) var(--space-4)",
                    border: "1px solid var(--green-400)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--green-50)",
                    color: "var(--green-700)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontWeight: 600,
                  }}
                >
                  <CheckCircle size={14} /> 保存并激活
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving || showEditorPreview}
                style={{
                  padding: "var(--space-2) var(--space-4)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-primary)",
                  color: "#fff",
                  cursor: saving || showEditorPreview ? "not-allowed" : "pointer",
                  fontSize: "0.85rem",
                  opacity: saving || showEditorPreview ? 0.6 : 1,
                  marginLeft: "auto",
                }}
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
            </div>
          </div>
        )}

        {!editing && (
          <div
            className="card"
            style={{ padding: "var(--space-8)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300 }}
          >
            <Layers size={40} style={{ color: "var(--text-tertiary)", opacity: 0.5, marginBottom: "var(--space-4)" }} />
            <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "var(--space-1)" }}>选择左侧版本进行编辑</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-tertiary)", marginBottom: "var(--space-4)" }}>
              点击版本名打开编辑器，或点击左侧 <Plus size={12} style={{ verticalAlign: "middle", color: "var(--color-primary)" }} /> 为场景创建新版本
            </div>
            {!prompts.length && (
              <button
                onClick={() => openNew("patient_chat")}
                style={{
                  padding: "var(--space-2) var(--space-5)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-primary)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                }}
              >
                <Plus size={14} /> 创建第一个版本
              </button>
            )}
          </div>
        )}
      </div>

      <Modal open={showActiveModal} onClose={() => setShowActiveModal(false)} title={null} maxWidth={900}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
          <select
            value={activeModalPurpose}
            onChange={(e) => handleActiveModalPurposeChange(e.target.value)}
            style={{
              padding: "var(--space-2) var(--space-3)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.85rem",
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
              fontWeight: 600,
            }}
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
          {previewData && <span style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>v{previewData.version}</span>}
          {previewData && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 2, background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-md)", padding: 2 }}>
              <button
                onClick={() => setShowRendered(true)}
                style={{
                  padding: "var(--space-1) var(--space-3)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: showRendered ? "var(--color-primary)" : "transparent",
                  color: showRendered ? "#fff" : "var(--text-secondary)",
                }}
              >
                渲染效果
              </button>
              <button
                onClick={() => setShowRendered(false)}
                style={{
                  padding: "var(--space-1) var(--space-3)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: !showRendered ? "var(--color-primary)" : "transparent",
                  color: !showRendered ? "#fff" : "var(--text-secondary)",
                }}
              >
                原始模板
              </button>
            </div>
          )}
        </div>

        {previewLoading ? (
          <div style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--text-tertiary)" }}>加载中...</div>
        ) : previewData ? (
          <>
            <div style={{ marginBottom: "var(--space-3)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>System Prompt</div>
              <pre
                style={{
                  margin: 0,
                  padding: "var(--space-3)",
                  background: "var(--bg-surface-subtle)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "0.8rem",
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  color: "var(--text-primary)",
                  maxHeight: 400,
                  overflow: "auto",
                  lineHeight: 1.6,
                }}
              >
                {showRendered ? previewData.system_prompt_rendered : renderHighlighted(previewData.system_prompt_raw)}
              </pre>
            </div>
            {previewData.user_prompt_raw && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>User Prompt Template</div>
                <pre
                  style={{
                    margin: 0,
                    padding: "var(--space-3)",
                    background: "var(--bg-surface-subtle)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.8rem",
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    color: "var(--text-primary)",
                    maxHeight: 300,
                    overflow: "auto",
                    lineHeight: 1.6,
                  }}
                >
                  {showRendered ? previewData.user_prompt_rendered : renderHighlighted(previewData.user_prompt_raw)}
                </pre>
              </div>
            )}
            {showRendered && previewData.sample_vars && Object.keys(previewData.sample_vars).length > 0 && (
              <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginTop: "var(--space-2)" }}>
                预览替换变量:{" "}
                {Object.entries(previewData.sample_vars).map(([k]) => (
                  <code key={k} style={{ marginLeft: 6, padding: "1px 6px", background: "var(--blue-50)", borderRadius: 3, fontSize: "0.65rem" }}>
                    {k}
                  </code>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--text-tertiary)" }}>该场景暂未激活任何版本</div>
        )}
      </Modal>
    </div>
  );
}
