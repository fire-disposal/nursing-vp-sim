import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration: number;
  entering: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: "success" | "error" | "warning" | "info", duration?: number) => number;
  success: (msg: string) => number;
  error: (msg: string) => number;
  warning: (msg: string) => number;
  info: (msg: string) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _nextId = 0;

const icons: Record<string, ReactNode> = {
  success: <CheckCircle size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />,
};

const colors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: "#f0fdf4", border: "#86efac", text: "#166534", icon: "#16a34a" },
  error: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", icon: "#dc2626" },
  warning: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e", icon: "#d97706" },
  info: { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af", icon: "#2563eb" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  const toast = useCallback(
    (message: string, type: "success" | "error" | "warning" | "info" = "info", duration = 4000) => {
      const id = ++_nextId;
      setToasts((prev) => {
        if (prev.length >= 5) return prev;
        return [...prev, { id, message, type, duration, entering: true }];
      });
      if (duration > 0) {
        timersRef.current[id] = setTimeout(() => remove(id), duration);
      }
      return id;
    },
    [remove],
  );

  const success = useCallback((msg: string) => toast(msg, "success"), [toast]);
  const error = useCallback((msg: string) => toast(msg, "error", 6000), [toast]);
  const warning = useCallback((msg: string) => toast(msg, "warning", 5000), [toast]);
  const info = useCallback((msg: string) => toast(msg, "info"), [toast]);

  useEffect(() => {
    const ids = toasts.filter((t) => t.entering).map((t) => t.id);
    if (ids.length > 0) {
      const timer = setTimeout(() => {
        setToasts((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, entering: false } : t)));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [toasts]);

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type} ${t.entering ? "toast-entering" : ""}`}
            style={{ background: colors[t.type].bg, borderColor: colors[t.type].border }}
          >
            <span style={{ color: colors[t.type].icon, display: "flex", flexShrink: 0 }}>{icons[t.type]}</span>
            <span style={{ color: colors[t.type].text, fontSize: "0.84rem", fontWeight: 500, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              {t.message}
            </span>
            <button type="button" className="toast-close" onClick={() => remove(t.id)}>
              <X size={14} />
            </button>
            {t.duration > 0 && (
              <div
                className="toast-progress"
                style={{ animationDuration: `${t.duration}ms`, background: colors[t.type].border }}
              />
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}
