import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { AlertTriangle, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmText?: string;
}

interface ConfirmContextType {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm(): ConfirmContextType {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}

const D = AlertDialogPrimitive;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolveRef = useRef<((val: boolean) => void) | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise((resolve) => {
        resolveRef.current = resolve;
        setState({ ...opts, open: true });
      }),
    [],
  );

  const handleClose = useCallback((val: boolean) => {
    resolveRef.current?.(val);
    resolveRef.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <D.Root open={state?.open ?? false} onOpenChange={() => handleClose(false)}>
        <D.Portal>
          <D.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000 }} />
          <D.Content
            style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              width: 420, maxWidth: "90vw", background: "#fff",
              borderRadius: 12, boxShadow: "0 20px 48px rgba(15,23,42,0.16)", zIndex: 2001, overflow: "hidden",
            }}
          >
            <div style={{ padding: "24px 24px 8px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 9999, background: state?.danger ? "#fef2f2" : "#fffbeb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <AlertTriangle size={20} style={{ color: state?.danger ? "#ef4444" : "#f59e0b" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <D.Title style={{ fontSize: "1.05rem", fontWeight: 600, color: "#111827", margin: "0 0 4px" }}>{state?.title}</D.Title>
                  <D.Description style={{ fontSize: "0.875rem", color: "#6b7280", lineHeight: 1.7 }}>{state?.message}</D.Description>
                </div>
                <button onClick={() => handleClose(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 4, flexShrink: 0 }}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "16px 24px 20px" }}>
              <D.Cancel asChild>
                <button type="button" onClick={() => handleClose(false)} style={{ padding: "7px 18px", fontSize: "0.875rem", fontWeight: 500, borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", cursor: "pointer" }}>
                  {state?.cancelLabel || "取消"}
                </button>
              </D.Cancel>
              <D.Action asChild>
                <button type="button" onClick={() => handleClose(true)} style={{ padding: "7px 18px", fontSize: "0.875rem", fontWeight: 500, borderRadius: 8, border: "none", cursor: "pointer", background: state?.danger ? "#ef4444" : "#2563eb", color: "#fff" }}>
                  {state?.confirmLabel || "确定"}
                </button>
              </D.Action>
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>
    </ConfirmContext.Provider>
  );
}

export default function ConfirmDialog({
  open, onConfirm, onCancel, title, message, confirmLabel = "确定", cancelLabel = "取消", danger = false,
}: {
  open: boolean; onConfirm: () => void; onCancel: () => void;
  title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <D.Portal>
        <D.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000 }} />
        <D.Content style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 420, maxWidth: "90vw", background: "#fff", borderRadius: 12, boxShadow: "0 20px 48px rgba(15,23,42,0.16)", zIndex: 2001, overflow: "hidden" }}>
          <div style={{ padding: "24px 24px 8px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 9999, background: danger ? "#fef2f2" : "#fffbeb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AlertTriangle size={20} style={{ color: danger ? "#ef4444" : "#f59e0b" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <D.Title style={{ fontSize: "1.05rem", fontWeight: 600, color: "#111827", margin: "0 0 4px" }}>{title}</D.Title>
                <D.Description style={{ fontSize: "0.875rem", color: "#6b7280", lineHeight: 1.7 }}>{message}</D.Description>
              </div>
              <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 4, flexShrink: 0 }}>
                <X size={18} />
              </button>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "16px 24px 20px" }}>
            <D.Cancel asChild>
              <button onClick={onCancel} style={{ padding: "7px 18px", fontSize: "0.875rem", fontWeight: 500, borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", cursor: "pointer" }}>{cancelLabel}</button>
            </D.Cancel>
            <D.Action asChild>
              <button onClick={onConfirm} style={{ padding: "7px 18px", fontSize: "0.875rem", fontWeight: 500, borderRadius: 8, border: "none", cursor: "pointer", background: danger ? "#ef4444" : "#2563eb", color: "#fff" }}>{confirmLabel}</button>
            </D.Action>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
