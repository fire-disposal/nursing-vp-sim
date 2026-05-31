import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Edit3, Trash2, CheckCircle, Play, Layers, ChevronDown, ChevronRight, RefreshCw, Hash, Eye } from "lucide-react";
import { fetchPrompts, createPrompt, updatePrompt, deletePrompt, activatePrompt, validatePrompt, reloadPrompts } from "../../api/apiManagement";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";

const PURPOSES = ["patient_chat", "scoring", "qa"];
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答" };

export default function PromptManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [prompts, setPrompts] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ purpose: "patient_chat", name: "", system_prompt: "", user_prompt: "", remark: "", activate: true });
  const [validation, setValidation] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetchPrompts(null).then(({ data }) => setPrompts(data)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!editing) setValidation(null); }, [editing]);

  const grouped = {};
  PURPOSES.forEach((p) => { grouped[p] = prompts.filter((t) => t.purpose === p).sort((a, b) => b.version - a.version); });

  const toggle = (p) => setExpanded((e) => ({ ...e, [p]: !e[p] }));

  const openNew = (purpose) => {
    setEditing("new");
    setForm({ purpose, name: "", system_prompt: "", user_prompt: purpose === "scoring" ? "" : "", remark: "", activate: true });
    setValidation(null);
  };
  const openEdit = (p) => {
    setEditing(p.id);
    setForm({ purpose: p.purpose, name: p.name || "", system_prompt: p.system_prompt, user_prompt: p.user_prompt || "", remark: p.remark || "", activate: false });
    setValidation(null);
  };

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
      const msg = Array.isArray(detail) ? detail.map((e) => e.msg || e.type || "未知错误").join("; ") : (detail || "保存失败");
      toast.error(msg);
    }
    finally { setSaving(false); }
  };

  const handleActivate = async (p) => {
    const ok = await confirm({ title: "切换版本", message: `「${PURPOSE_LABELS[p.purpose]}」切换到 v${p.version} "${p.name || ''}"？`, confirmText: "切换" });
    if (!ok) return;
    try { await activatePrompt(p.id); toast.success(`已切换到 v${p.version}`); load(); }
    catch (err) { const d = err.response?.data?.detail; toast.error(Array.isArray(d) ? d.map((e) => e.msg).join("; ") : (d || "激活失败")); }
  };

  const handleDelete = async (p) => {
    if (p.is_active) { toast.error("不能删除当前激活的版本"); return; }
    const ok = await confirm({ title: "删除", message: `删除「${PURPOSE_LABELS[p.purpose]}」v${p.version}?`, confirmText: "删除", danger: true });
    if (!ok) return;
    try { await deletePrompt(p.id); if (editing === p.id) setEditing(null); toast.success("已删除"); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "删除失败"); }
  };

  const handleValidate = async () => {
    try {
      const { data } = await validatePrompt({ system_prompt: form.system_prompt, user_prompt: form.user_prompt || null });
      setValidation(data);
    } catch (err) { toast.error("校验失败"); }
  };

  const handleReload = async () => {
    try { await reloadPrompts(); toast.success("模板已热加载"); }
    catch (err) { toast.error("热加载失败"); }
  };

  const handleShowActive = () => {
    const active = PURPOSES.map((p) => {
      const v = grouped[p]?.find((t) => t.is_active);
      return v ? `${PURPOSE_LABELS[p]} v${v.version}${v.name ? ` (${v.name})` : ""}` : `${PURPOSE_LABELS[p]} 未激活`;
    }).join("  ·  ");
    setExpanded(Object.fromEntries(PURPOSES.map((p) => [p, true])));
    toast.success(active);
  };

  const editorTitle = editing === "new"
    ? `新建「${PURPOSE_LABELS[form.purpose]}」`
    : editing
      ? (() => { const t = prompts.find((p) => p.id === editing); return t ? `编辑「${PURPOSE_LABELS[t.purpose]}」v${t.version}` : "编辑"; })()
      : null;

  const extractVars = (text) => [...new Set((text.match(/\{(\w+)\}/g) || []).map((v) => v.slice(1, -1)))];
  const currentVars = useMemo(() => extractVars(form.system_prompt + (form.user_prompt || "")), [form.system_prompt, form.user_prompt]);
  const editedPrompt = editing && editing !== "new" ? prompts.find((p) => p.id === editing) : null;
  const dbVars = editedPrompt?.variables || [];

  return (
    <div>
      <div style={{ marginBottom: "var(--space-4)", display: "flex", gap: "var(--space-2)" }}>
        <button onClick={handleReload} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--amber-400)", borderRadius: "var(--radius-md)", background: "var(--amber-50)", color: "var(--amber-700)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
          <RefreshCw size={13} /> 热加载
        </button>
        <button onClick={handleShowActive} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--color-primary)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--color-primary)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
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
                    display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-3) var(--space-4)",
                    cursor: "pointer", userSelect: "none", fontWeight: 600, fontSize: "0.85rem",
                    background: "var(--bg-surface-subtle)", color: "var(--text-primary)",
                  }}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span style={{ flex: 1 }}>{PURPOSE_LABELS[purpose]}</span>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", fontWeight: 400 }}>
                    {versions.filter((v) => v.is_active).length > 0
                      ? `v${versions.find((v) => v.is_active).version} · ${versions.length}个版本`
                      : `${versions.length}个版本`}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); openNew(purpose); }}
                    style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", padding: 2 }} title="新建">
                    <Plus size={15} />
                  </button>
                </div>
                {isOpen && (
                  <div>
                    {versions.length === 0 ? (
                      <div style={{ padding: "var(--space-3) var(--space-4)", color: "var(--text-tertiary)", fontSize: "0.8rem" }}>
                        暂无模板
                      </div>
                    ) : versions.map((v) => (
                      <div key={v.id}
                        onClick={() => openEdit(v)}
                        style={{
                          display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-4)",
                          borderTop: "1px solid var(--border-color)", cursor: "pointer",
                          background: editing === v.id ? "var(--blue-50)" : v.is_active ? "var(--green-50)" : "transparent",
                          transition: "background 0.1s",
                        }}
                      >
                        <span style={{
                          fontSize: "0.7rem", fontWeight: 700, padding: "1px 6px",
                          borderRadius: "var(--radius-sm)", background: "var(--bg-surface)",
                          border: "1px solid var(--border-color)", minWidth: 28, textAlign: "center",
                        }}>v{v.version}</span>
                        <span style={{ flex: 1, fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {v.name || "-"}
                        </span>
                        {v.is_active && (
                          <span style={{
                            fontSize: "0.65rem", padding: "1px 6px", borderRadius: "var(--radius-full)",
                            background: "var(--green-100)", color: "var(--green-700)", whiteSpace: "nowrap",
                            display: "inline-flex", alignItems: "center", gap: 2,
                          }}>
                            <CheckCircle size={10} /> 激活
                          </span>
                        )}
                        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 1 }}>
                          {!v.is_active && (
                            <button onClick={() => handleActivate(v)} style={{ background: "none", border: "none", color: "var(--green-500)", cursor: "pointer", padding: 2 }} title="激活">
                              <CheckCircle size={13} />
                            </button>
                          )}
                          <button onClick={() => handleDelete(v)} style={{ background: "none", border: "none", color: "var(--red-400)", cursor: "pointer", padding: 2 }} title="删除">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
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
                <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
                  更新于 {new Date(editedPrompt.updated_at).toLocaleString("zh-CN")}
                </span>
              )}
            </div>

            {editing === "new" && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>场景</label>
                <select value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)" }}>
                  {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>版本名称</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="v2-优化版"
                  style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>备注</label>
                <input value={form.remark} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} placeholder="修改说明..."
                  style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", marginBottom: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>System Prompt</label>
                <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>{form.system_prompt.length} 字符</span>
              </div>
              <textarea value={form.system_prompt} onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                style={{ flex: 1, minHeight: 200, width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.8rem", fontFamily: "monospace", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box", resize: "vertical" }} />
            </div>
            {form.purpose === "scoring" && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>User Prompt Template</label>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>{(form.user_prompt || "").length} 字符</span>
                </div>
                <textarea value={form.user_prompt} onChange={(e) => setForm((f) => ({ ...f, user_prompt: e.target.value }))} rows={6}
                  style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.8rem", fontFamily: "monospace", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box", resize: "vertical" }} />
              </div>
            )}

            <div style={{ marginBottom: "var(--space-3)", display: "flex", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                  <Hash size={12} /> 模板变量 {currentVars.length > 0 && `(${currentVars.length})`}
                </div>
                {currentVars.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {currentVars.map((v) => {
                      const desc = dbVars.find((d) => d.name === v);
                      return (
                        <span key={v} title={desc?.desc || ""} style={{
                          padding: "2px 10px", borderRadius: "var(--radius-full)", fontSize: "0.7rem",
                          background: "var(--blue-50)", color: "var(--blue-700)",
                          border: "1px solid var(--blue-200)", fontFamily: "monospace",
                        }}>
                          {`{${v}}`}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>无变量（纯静态 prompt）</span>
                )}
              </div>
            </div>
            {validation && (
              <div style={{ padding: "var(--space-3)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-3)",
                background: validation.valid ? "var(--green-50)" : "var(--red-50)",
                color: validation.valid ? "var(--green-700)" : "var(--red-700)", fontSize: "0.8rem" }}>
                {validation.valid ? "校验通过" : validation.errors.join("; ")}
                {validation.missing_vars?.length > 0 && <div style={{ marginTop: 4 }}>变量未声明: {validation.missing_vars.join(", ")}</div>}
              </div>
            )}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <button onClick={handleValidate} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 4 }}>
                <Play size={14} /> 校验语法
              </button>
              <button onClick={handleSave} disabled={saving} style={{ padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)", background: "var(--color-primary)", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: "0.85rem", opacity: saving ? 0.6 : 1 }}>
                {saving ? "保存中..." : editing === "new" ? "创建版本" : "保存修改"}
              </button>
              <button onClick={() => setEditing(null)} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.85rem" }}>取消</button>
            </div>
          </div>
        )}

        {!editing && (
          <div className="card" style={{ padding: "var(--space-8)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
            <Layers size={40} style={{ color: "var(--text-tertiary)", opacity: 0.5, marginBottom: "var(--space-4)" }} />
            <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "var(--space-1)" }}>选择左侧版本进行编辑</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-tertiary)", marginBottom: "var(--space-4)" }}>
              点击版本名打开编辑器，或点击左侧 <Plus size={12} style={{ verticalAlign: "middle", color: "var(--color-primary)" }} /> 为场景创建新版本
            </div>
            {!prompts.length && (
              <button onClick={() => openNew("patient_chat")} style={{
                padding: "var(--space-2) var(--space-5)", border: "none", borderRadius: "var(--radius-md)",
                background: "var(--color-primary)", color: "#fff", cursor: "pointer",
                fontSize: "0.85rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-1)",
              }}>
                <Plus size={14} /> 创建第一个版本
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
