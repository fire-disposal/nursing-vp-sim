import { useState, useEffect, useCallback } from "react";
import { Plus, Edit3, Trash2, CheckCircle, Play, Layers } from "lucide-react";
import { fetchPrompts, createPrompt, updatePrompt, deletePrompt, activatePrompt, validatePrompt, reloadPrompts } from "../../api/apiManagement";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";

const PURPOSES = ["patient_chat", "scoring", "qa"];
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答" };
const PURPOSE_ICONS = { patient_chat: "💬", scoring: "📊", qa: "❓" };

export default function PromptManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [prompts, setPrompts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ purpose: "patient_chat", name: "", system_prompt: "", user_prompt: "", remark: "", activate: true });
  const [validation, setValidation] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetchPrompts(null).then(({ data }) => setPrompts(data)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = {};
  PURPOSES.forEach((p) => { grouped[p] = prompts.filter((t) => t.purpose === p).sort((a, b) => b.version - a.version); });

  const openNew = (purpose) => {
    setEditing(null);
    setForm({ purpose, name: "", system_prompt: "", user_prompt: purpose === "scoring" ? "" : "", remark: "", activate: true });
    setValidation(null);
    setShowForm(true);
  };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ purpose: p.purpose, name: p.name || "", system_prompt: p.system_prompt, user_prompt: p.user_prompt || "", remark: p.remark || "", activate: false });
    setValidation(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await updatePrompt(editing.id, { name: form.name, system_prompt: form.system_prompt, user_prompt: form.user_prompt || null, remark: form.remark });
        toast.success("已保存");
      } else {
        await createPrompt(form);
        toast.success("已创建");
      }
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "保存失败"); }
    finally { setSaving(false); }
  };

  const handleActivate = async (p) => {
    const ok = await confirm({ title: "切换版本", message: `将「${PURPOSE_LABELS[p.purpose]}」切换到 v${p.version} "${p.name || ''}"？立即生效！`, confirmText: "切换到 v" + p.version });
    if (!ok) return;
    try { await activatePrompt(p.id); toast.success(`「${PURPOSE_LABELS[p.purpose]}」已切换到 v${p.version}`); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "激活失败"); }
  };

  const handleDelete = async (p) => {
    if (p.is_active) { toast.error("不能删除当前激活的版本"); return; }
    const ok = await confirm({ title: "删除版本", message: `删除「${PURPOSE_LABELS[p.purpose]}」v${p.version}?`, confirmText: "删除", danger: true });
    if (!ok) return;
    try { await deletePrompt(p.id); toast.success("已删除"); load(); }
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

  const activeVersion = (purpose) => {
    const list = grouped[purpose] || [];
    return list.find((t) => t.is_active) || null;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: "var(--space-4)", gap: "var(--space-2)" }}>
        <button onClick={handleReload} style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem" }}>
          热加载
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: "var(--space-5)", padding: "var(--space-5)" }}>
          <h4 style={{ margin: "0 0 var(--space-4) 0", fontSize: "0.95rem" }}>{editing ? `编辑「${PURPOSE_LABELS[form.purpose]}」v${editing.version}` : `新建「${PURPOSE_LABELS[form.purpose]}」模板`}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>场景</label>
              <select disabled={!!editing} value={form.purpose} onChange={(e) => setForm(f => ({...f, purpose: e.target.value}))}
                style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)" }}>
                {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_ICONS[p]} {PURPOSE_LABELS[p]}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>版本名称</label>
              <input value={form.name} onChange={(e) => setForm(f => ({...f, name: e.target.value}))} placeholder="v2-优化版" style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginBottom: "var(--space-3)" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>System Prompt</label>
            <textarea value={form.system_prompt} onChange={(e) => setForm(f => ({...f, system_prompt: e.target.value}))} rows={8}
              style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.8rem", fontFamily: "monospace", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box", resize: "vertical" }} />
          </div>
          {form.purpose === "scoring" && (
            <div style={{ marginBottom: "var(--space-3)" }}>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>User Prompt Template</label>
              <textarea value={form.user_prompt} onChange={(e) => setForm(f => ({...f, user_prompt: e.target.value}))} rows={4}
                style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.8rem", fontFamily: "monospace", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box", resize: "vertical" }} />
            </div>
          )}
          <div style={{ marginBottom: "var(--space-3)" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>备注</label>
            <input value={form.remark} onChange={(e) => setForm(f => ({...f, remark: e.target.value}))} placeholder="修改说明..." style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box" }} />
          </div>
          {validation && (
            <div style={{ padding: "var(--space-3)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-3)",
              background: validation.valid ? "var(--green-50)" : "var(--red-50)",
              color: validation.valid ? "var(--green-700)" : "var(--red-700)", fontSize: "0.8rem" }}>
              {validation.valid ? "校验通过" : validation.errors.join("; ")}
              {validation.missing_vars?.length > 0 && <div style={{ marginTop: 4 }}>未声明变量: {validation.missing_vars.join(", ")}</div>}
            </div>
          )}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button onClick={handleValidate} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 4 }}>
              <Play size={14} /> 校验语法
            </button>
            <button onClick={handleSave} disabled={saving} style={{ padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)", background: "var(--color-primary)", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: "0.85rem", opacity: saving ? 0.6 : 1 }}>
              {saving ? "保存中..." : editing ? "保存修改" : "创建版本"}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.85rem" }}>取消</button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-4)" }}>
        {PURPOSES.map((purpose) => {
          const versions = grouped[purpose] || [];
          const active = activeVersion(purpose);
          return (
            <div key={purpose} className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "var(--space-4)", borderBottom: "1px solid var(--border-color)", background: "var(--bg-surface-subtle)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                  <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                    <span>{PURPOSE_ICONS[purpose]}</span>
                    {PURPOSE_LABELS[purpose]}
                  </h4>
                  <button onClick={() => openNew(purpose)} style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", padding: "var(--space-1)", borderRadius: "var(--radius-sm)" }} title="新建版本">
                    <Plus size={16} />
                  </button>
                </div>
                {active ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span style={{
                      padding: "2px 10px", borderRadius: "var(--radius-full)", fontSize: "0.75rem",
                      background: "var(--green-100)", color: "var(--green-700)", fontWeight: 600,
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}>
                      <CheckCircle size={12} /> 当前 v{active.version}
                    </span>
                    {active.name && <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>{active.name}</span>}
                  </div>
                ) : (
                  <div style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>
                    <Layers size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                    暂无模板
                  </div>
                )}
              </div>
              <div style={{ padding: "var(--space-2) 0" }}>
                {versions.length === 0 ? (
                  <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--text-tertiary)", fontSize: "0.8rem" }}>
                    点击 <Plus size={12} style={{ verticalAlign: "middle" }} /> 创建第一个版本
                  </div>
                ) : versions.map((v) => (
                  <div key={v.id} style={{
                    display: "flex", alignItems: "center", gap: "var(--space-2)",
                    padding: "var(--space-2) var(--space-4)",
                    borderBottom: "1px solid var(--border-color)",
                    background: v.is_active ? "var(--green-50)" : "transparent",
                    transition: "background 0.15s",
                  }}>
                    <span style={{
                      minWidth: 32, textAlign: "center", fontSize: "0.75rem", fontWeight: 600,
                      padding: "1px 6px", borderRadius: "var(--radius-sm)",
                      background: "var(--bg-surface)", color: "var(--text-secondary)",
                      border: "1px solid var(--border-color)",
                    }}>v{v.version}</span>
                    <span style={{ flex: 1, fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name || `v${v.version}`}</span>
                    {v.remark && <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.remark}>{v.remark}</span>}
                    <div style={{ display: "flex", gap: 2 }}>
                      {!v.is_active && (
                        <button onClick={() => handleActivate(v)} style={{ background: "none", border: "none", color: "var(--green-500)", cursor: "pointer", padding: 2 }} title="切换到此版本">
                          <CheckCircle size={14} />
                        </button>
                      )}
                      <button onClick={() => openEdit(v)} style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", padding: 2 }} title="编辑">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => handleDelete(v)} style={{ background: "none", border: "none", color: "var(--red-400)", cursor: "pointer", padding: 2 }} title="删除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
