import { useState, useEffect, useCallback } from "react";
import { Plus, Edit3, Trash2, CheckCircle, Play } from "lucide-react";
import { fetchPrompts, createPrompt, updatePrompt, deletePrompt, activatePrompt, validatePrompt, reloadPrompts } from "../../api/apiManagement";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";

const PURPOSES = ["patient_chat", "scoring", "qa"];
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答" };

export default function PromptManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [prompts, setPrompts] = useState([]);
  const [filterPurpose, setFilterPurpose] = useState("");
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ purpose: "patient_chat", name: "", system_prompt: "", user_prompt: "", remark: "", activate: true });
  const [validation, setValidation] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetchPrompts(filterPurpose || null).then(({ data }) => setPrompts(data)).catch(() => toast.error("加载失败"));
  }, [filterPurpose, toast]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm({ purpose: filterPurpose || "patient_chat", name: "", system_prompt: "", user_prompt: "", remark: "", activate: true });
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
    const ok = await confirm({ title: "激活模板", message: `切换到 v${p.version} "${p.name || ''}"？立即生效！`, confirmText: "激活" });
    if (!ok) return;
    try { await activatePrompt(p.id); toast.success("已激活"); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "激活失败"); }
  };

  const handleDelete = async (p) => {
    if (p.is_active) { toast.error("不能删除当前激活的模板"); return; }
    const ok = await confirm({ title: "删除模板", message: `删除 v${p.version}?`, confirmText: "删除", danger: true });
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

  const s = { borderCollapse: "collapse", fontSize: "0.85rem", width: "100%" };
  const th = { padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--text-secondary)", fontWeight: 600, borderBottom: "2px solid var(--border-color)", fontSize: "0.75rem" };
  const td = { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color)" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <select value={filterPurpose} onChange={(e) => setFilterPurpose(e.target.value)} style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)" }}>
            <option value="">全部场景</option>
            {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>)}
          </select>
          <button onClick={handleReload} style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem" }}>热加载</button>
        </div>
        <button onClick={openNew} style={{ padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
          <Plus size={14} /> 新建版本
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: "var(--space-5)", padding: "var(--space-5)" }}>
          <h4 style={{ margin: "0 0 var(--space-4) 0", fontSize: "0.95rem" }}>{editing ? "编辑模板" : "新建模板"}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>场景</label>
              <select disabled={!!editing} value={form.purpose} onChange={(e) => setForm(f => ({...f, purpose: e.target.value}))}
                style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)" }}>
                {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>)}
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
              {validation.valid ? "✓ 语法校验通过" : "✗ " + validation.errors.join("; ")}
              {validation.missing_vars?.length > 0 && <div style={{ marginTop: 4 }}>未声明的变量: {validation.missing_vars.join(", ")}</div>}
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

      <div className="card" style={{ overflow: "auto" }}>
        <table style={s}>
          <thead><tr>
            <th style={th}>场景</th><th style={th}>版本</th><th style={th}>名称</th><th style={th}>System Prompt 预览</th><th style={th}>状态</th><th style={th}>备注</th><th style={th}>操作</th>
          </tr></thead>
          <tbody>
            {prompts.length === 0 ? (
              <tr><td colSpan={7} style={{ ...td, textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>暂无模板（首次启动会自动创建默认版本）</td></tr>
            ) : prompts.map((p) => (
              <tr key={p.id}>
                <td style={td}><span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem", background: "var(--bg-surface-subtle)" }}>{PURPOSE_LABELS[p.purpose] || p.purpose}</span></td>
                <td style={td}>v{p.version}</td>
                <td style={td}>{p.name || "-"}</td>
                <td style={{ ...td, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "0.75rem" }}>{p.system_prompt}</td>
                <td style={td}>
                  {p.is_active ? (
                    <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem", background: "var(--green-100)", color: "var(--green-700)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                      <CheckCircle size={12} /> 激活
                    </span>
                  ) : null}
                </td>
                <td style={{ ...td, fontSize: "0.75rem", color: "var(--text-tertiary)" }}>{p.remark || "-"}</td>
                <td style={td}>
                  {!p.is_active && (
                    <button onClick={() => handleActivate(p)} style={{ background: "none", border: "none", color: "var(--green-500)", cursor: "pointer", padding: "var(--space-1)" }}>
                      <CheckCircle size={14} />
                    </button>
                  )}
                  <button onClick={() => openEdit(p)} style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", padding: "var(--space-1)" }}>
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => handleDelete(p)} style={{ background: "none", border: "none", color: "var(--red-400)", cursor: "pointer", padding: "var(--space-1)" }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
