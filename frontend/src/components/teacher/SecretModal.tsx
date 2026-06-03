import { useEffect, useState } from "react";
import { createSecret, updateSecret } from "@/api/api-client";
import { useToast } from "@/components/Toast";
import Modal from "@/components/ui/Modal";
import type { components } from "@/api/api-types.gen";

type Schemas = components["schemas"];
type ApiSecretResponse = Schemas["ApiSecretResponse"];

interface SecretModalProps {
  open: boolean;
  secret: ApiSecretResponse | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function SecretModal({ open, secret, onClose, onSaved }: SecretModalProps) {
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [rawKey, setRawKey] = useState("");
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const isEdit = secret != null;

  useEffect(() => {
    if (open) {
      setLabel(secret?.label || "");
      setBaseUrl((secret as any)?.base_url || "");
      setRawKey("");
    }
  }, [open, secret]);

  const handleSave = async () => {
    if (!label.trim()) return;
    if (!isEdit && !rawKey.trim()) return;
    setSaving(true);
    try {
      if (isEdit) {
        await updateSecret(secret.id, { label: label.trim(), base_url: baseUrl.trim() } as any);
        success("密钥已更新");
      } else {
        await createSecret({ label: label.trim(), raw_key: rawKey.trim(), base_url: baseUrl.trim() || undefined } as any);
        success("密钥已创建");
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      error(err.response?.data?.detail || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "编辑密钥凭证" : "添加密钥凭证"}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <label>
          <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>标签</div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="如: DeepSeek 个人账号"
            style={{
              width: "100%",
              padding: "var(--space-2) var(--space-3)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.85rem",
              boxSizing: "border-box",
            }}
          />
        </label>
        <label>
          <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>API 端点 (Base URL)</div>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com"
            style={{
              width: "100%",
              padding: "var(--space-2) var(--space-3)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.85rem",
              boxSizing: "border-box",
              fontFamily: "monospace",
            }}
          />
        </label>
        {!isEdit && (
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>API Key</div>
            <input
              type="password"
              value={rawKey}
              onChange={(e) => setRawKey(e.target.value)}
              placeholder="sk-..."
              style={{
                width: "100%",
                padding: "var(--space-2) var(--space-3)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                fontSize: "0.85rem",
                boxSizing: "border-box",
              }}
            />
          </label>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <button onClick={onClose} className="btn btn-secondary">
            取消
          </button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
