import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right" | "bottom";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

const WIDTH_MAP: Record<string, string> = {
  sm: "w-[85vw] max-w-xs",
  md: "w-80",
  lg: "w-96",
};
const HEIGHT_MAP: Record<string, string> = {
  sm: "h-[40vh]",
  md: "h-[65vh]",
  lg: "h-[85vh]",
};

const SIDE_CLASSES: Record<string, string> = {
  left: "left-0 top-0 h-full border-r -translate-x-full data-[state=open]:translate-x-0",
  right: "right-0 top-0 h-full border-l translate-x-full data-[state=open]:translate-x-0",
  bottom: "inset-x-0 bottom-0 border-t translate-y-full data-[state=open]:translate-y-0 rounded-t-2xl",
};

export default function Sheet({ open, onClose, side = "right", size = "md", children }: SheetProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", onKey);
      return () => {
        document.body.style.overflow = "";
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [open, onClose]);

  if (!open) return null;

  const dimension = side === "bottom" ? HEIGHT_MAP[size] : WIDTH_MAP[size];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0" onClick={onClose} />
      <div
        data-state={open ? "open" : "closed"}
        className={cn("fixed z-50 bg-background shadow-2xl transition-transform duration-300 ease-out overscroll-contain", dimension, SIDE_CLASSES[side])}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 size-10 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          aria-label="关闭面板"
        >
          <X size={20} />
        </button>
        <div className="h-full overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
