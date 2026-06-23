import { toast as sonnerToast } from "sonner";
import { getApiErrorMessage } from "@/lib/error-utils";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastApi {
	toast: (message: string, type?: ToastType, duration?: number) => number;
	success: (msg: string) => number;
	error: (msg: string) => number;
	warning: (msg: string) => number;
	info: (msg: string) => number;
	apiError: (e: unknown, fallback?: string) => number;
}

let _nextId = 0;

function show(message: string, type: ToastType = "info", duration = 4000) {
	sonnerToast[type](message, { id: `${type}:${message}`, duration });
	return ++_nextId;
}

export const toast: ToastApi = {
	toast: show,
	success: (msg: string) => show(msg, "success"),
	error: (msg: string) => show(msg, "error", 6000),
	warning: (msg: string) => show(msg, "warning", 5000),
	info: (msg: string) => show(msg, "info"),
	apiError: (e: unknown, fallback = "操作失败") =>
		show(getApiErrorMessage(e, fallback), "error", 6000),
};

export function useToast(): ToastApi {
	return toast;
}
