import { toast as sonnerToast } from "sonner";
import { getApiErrorMessage } from "@/utils/error";

type ToastType = "success" | "error" | "warning" | "info";

type ToastOptions = {
	description?: string;
	action?: { label: string; onClick: () => void };
};

interface ToastApi {
	toast: (message: string, type?: ToastType, duration?: number, options?: ToastOptions) => number;
	success: (msg: string, options?: ToastOptions & { duration?: number }) => number;
	error: (msg: string, options?: ToastOptions & { duration?: number }) => number;
	warning: (msg: string, options?: ToastOptions & { duration?: number }) => number;
	info: (msg: string, options?: ToastOptions & { duration?: number }) => number;
	apiError: (e: unknown, fallback?: string) => number;
}

let _nextId = 0;

function show(message: string, type: ToastType = "info", duration = 4000, options?: ToastOptions) {
	const id = `t:${++_nextId}:${Date.now()}`;
	const { description, action } = options ?? {};
	sonnerToast[type](message, {
		id,
		duration,
		description,
		action: action ? { label: action.label, onClick: action.onClick } : undefined,
		style: { "--toast-duration": `${duration}ms` } as React.CSSProperties,
	});
	return _nextId;
}

export const toast: ToastApi = {
	toast: show,
	success: (msg: string, opts?: ToastOptions & { duration?: number }) =>
		show(msg, "success", opts?.duration ?? 6000, opts),
	error: (msg: string, opts?: ToastOptions & { duration?: number }) =>
		show(msg, "error", opts?.duration ?? 6000, opts),
	warning: (msg: string, opts?: ToastOptions & { duration?: number }) =>
		show(msg, "warning", opts?.duration ?? 5000, opts),
	info: (msg: string, opts?: ToastOptions & { duration?: number }) =>
		show(msg, "info", opts?.duration ?? 4000, opts),
	apiError: (e: unknown, fallback = "操作失败") =>
		show(getApiErrorMessage(e, fallback), "error", 6000),
};

export function useToast(): ToastApi {
	return toast;
}
