import { useState, useEffect } from "react";
import Modal from "../ui/Modal";
import { createProvider, updateProvider } from "../../api/apiManagement";
import { useToast } from "../Toast";

export default function ProviderModal({ open, provider, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: "",
    display_name: "",
    base_url: "",
    default_model: "",
    is_enabled: true,
    priority: 100,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (provider) {
      setForm({
        name: provider.name || "",
        display_name: provider.display_name || "",
        base_url: provider.base_url || "",
        default_model: provider.default_model || "",
        is_enabled: provider.is_enabled !== false,
        priority: provider.priority ?? 100,
      });
    } else {
      setForm({
        name: "",
        display_name: "",
        base_url: "",
        default_model: "",
        is_enabled: true,
        priority: 100,
      });
    }
  }, [provider, open]);

  const handleChange = (field) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (provider) {
        await updateProvider(provider.id, form);
        toast.success("Provider updated");
      } else {
        await createProvider(form);
        toast.success("Provider created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Save failed");
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
      title={provider ? "Edit Provider" : "Add Provider"}
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
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
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
            {saving ? "Saving..." : "Save"}
          </button>
        </>
      }
    >
      <form onSubmit={handleSave}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} value={form.name} onChange={handleChange("name")} placeholder="e.g. openai" required />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Display Name</label>
          <input style={inputStyle} value={form.display_name} onChange={handleChange("display_name")} placeholder="e.g. OpenAI" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Base URL *</label>
          <input style={inputStyle} value={form.base_url} onChange={handleChange("base_url")} placeholder="e.g. https://api.openai.com/v1" required />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Default Model</label>
          <input style={inputStyle} value={form.default_model} onChange={handleChange("default_model")} placeholder="e.g. gpt-4o" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Priority</label>
          <input style={inputStyle} type="number" value={form.priority} onChange={handleChange("priority")} />
        </div>
        <div style={fieldStyle}>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_enabled} onChange={handleChange("is_enabled")} />
            Enabled
          </label>
        </div>
      </form>
    </Modal>
  );
}
