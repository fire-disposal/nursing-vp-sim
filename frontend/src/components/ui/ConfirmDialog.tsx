import { AlertTriangle, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export default function ConfirmDialog({ open, onConfirm, onCancel, title, message, confirmLabel = "确定", cancelLabel = "取消", danger = false }: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 20px 48px rgba(15,23,42,0.16)",
          width: "100%",
          maxWidth: 420,
          margin: 16,
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "24px 24px 8px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 9999,
                background: danger ? "#fef2f2" : "#fffbeb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <AlertTriangle size={20} style={{ color: danger ? "#ef4444" : "#f59e0b" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: "#111827", marginBottom: 4 }}>{title}</h3>
              <p style={{ fontSize: "0.875rem", color: "#6b7280", lineHeight: 1.7 }}>{message}</p>
            </div>
            <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 4, flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "16px 24px 20px" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "7px 18px",
              fontSize: "0.875rem",
              fontWeight: 500,
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#374151",
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "7px 18px",
              fontSize: "0.875rem",
              fontWeight: 500,
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              background: danger ? "#ef4444" : "#2563eb",
              color: "#fff",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmText?: string;
}

interface ConfirmContextType {
  confirm: (opts: ConfirmState) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm(): ConfirmContextType {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolveRef = useRef<((val: boolean) => void) | null>(null);

  const confirm = useCallback(({ title, message, confirmLabel = "确定", cancelLabel = "取消", danger = false }: ConfirmState): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ title, message, confirmLabel, cancelLabel, danger });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (resolveRef.current) resolveRef.current(true);
    setState(null);
  }, []);

  const handleCancel = useCallback(() => {
    if (resolveRef.current) resolveRef.current(false);
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
          }}
          onClick={handleCancel}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 20px 48px rgba(15,23,42,0.16)",
              width: "100%",
              maxWidth: 420,
              margin: 16,
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "24px 24px 8px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 9999,
                    background: state.danger ? "#fef2f2" : "#fffbeb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <AlertTriangle size={20} style={{ color: state.danger ? "#ef4444" : "#f59e0b" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: "#111827", marginBottom: 4 }}>{state.title}</h3>
                  <p style={{ fontSize: "0.875rem", color: "#6b7280", lineHeight: 1.7 }}>{state.message}</p>
                </div>
                <button onClick={handleCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 4, flexShrink: 0 }}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "16px 24px 20px" }}>
              <button
                onClick={handleCancel}
                style={{
                  padding: "7px 18px",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                {state.cancelLabel}
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  padding: "7px 18px",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background: state.danger ? "#ef4444" : "#2563eb",
                  color: "#fff",
                }}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
