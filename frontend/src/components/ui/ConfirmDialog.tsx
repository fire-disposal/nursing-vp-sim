import { AlertTriangle, X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

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

  const isDanger = state?.danger ?? false;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <AlertDialog open={state?.open ?? false} onOpenChange={() => handleClose(false)}>
        <AlertDialogContent className="max-w-[420px]">
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full",
                  isDanger ? "bg-red-50 dark:bg-red-950" : "bg-amber-50 dark:bg-amber-950",
                )}
              >
                <AlertTriangle size={20} className={isDanger ? "text-red-500" : "text-amber-500"} />
              </div>
              <div className="min-w-0 flex-1">
                <AlertDialogTitle className="text-base font-semibold">{state?.title}</AlertDialogTitle>
                <AlertDialogDescription className="mt-1 text-sm leading-relaxed text-muted-foreground">{state?.message}</AlertDialogDescription>
              </div>
              <button type="button" onClick={() => handleClose(false)} className="flex shrink-0 cursor-pointer p-1 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleClose(false)}>{state?.cancelLabel || "取消"}</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleClose(true)} className={isDanger ? "bg-destructive hover:bg-destructive/90" : undefined}>
              {state?.confirmLabel || "确定"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = "确定",
  cancelLabel = "取消",
  danger = false,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={() => onCancel()}>
      <AlertDialogContent className="max-w-[420px]">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                danger ? "bg-red-50 dark:bg-red-950" : "bg-amber-50 dark:bg-amber-950",
              )}
            >
              <AlertTriangle size={20} className={danger ? "text-red-500" : "text-amber-500"} />
            </div>
            <div className="min-w-0 flex-1">
              <AlertDialogTitle className="text-base font-semibold">{title}</AlertDialogTitle>
              <AlertDialogDescription className="mt-1 text-sm leading-relaxed text-muted-foreground">{message}</AlertDialogDescription>
            </div>
            <button type="button" onClick={onCancel} className="flex shrink-0 cursor-pointer p-1 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={danger ? "bg-destructive hover:bg-destructive/90" : undefined}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
