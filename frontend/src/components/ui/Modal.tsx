import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  style?: React.CSSProperties;
  className?: string;
}

export default function Modal({ open, onClose, title, children, footer, maxWidth, style, className }: ModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className={cn("max-h-[85vh] overflow-auto p-0", className)} style={{ maxWidth: maxWidth ?? 560, ...style }}>
        {title && (
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
        )}
        <div className="px-6 py-3">{children}</div>
        {footer && <DialogFooter className="px-6 pb-6">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
