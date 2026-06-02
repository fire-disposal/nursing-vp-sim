import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  style?: React.CSSProperties;
}

export default function Modal({ open, onClose, title, children, footer, maxWidth = 560, style }: ModalProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 1000,
            animation: "fadeIn 0.15s ease",
          }}
        />
        <DialogPrimitive.Content
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: maxWidth,
            maxWidth: "90vw",
            maxHeight: "85vh",
            overflow: "auto",
            background: "#fff",
            borderRadius: "var(--radius-lg, 12px)",
            boxShadow: "var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.15))",
            zIndex: 1001,
            padding: 0,
            ...style,
          }}
        >
          {title && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 0",
              }}
            >
              <DialogPrimitive.Title style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Close
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--gray-400)",
                  padding: 4,
                  display: "flex",
                }}
              >
                <X size={20} />
              </DialogPrimitive.Close>
            </div>
          )}
          <div style={{ padding: "12px 24px" }}>{children}</div>
          {footer && <div style={{ padding: "0 24px 20px", display: "flex", gap: 12, justifyContent: "flex-end" }}>{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
