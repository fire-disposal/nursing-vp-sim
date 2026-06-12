import { toast as sonnerToast } from "sonner";

interface ToastContextValue {
	toast: (
		message: string,
		type?: "success" | "error" | "warning" | "info",
		duration?: number,
	) => number;
	success: (msg: string) => number;
	error: (msg: string) => number;
	warning: (msg: string) => number;
	info: (msg: string) => number;
}

let _nextId = 0;

function toast(
	message: string,
	type: "success" | "error" | "warning" | "info" = "info",
	duration = 4000,
) {
	const id = ++_nextId;
	sonnerToast[type](message, { id: String(id), duration });
	return id;
}

const ctx: ToastContextValue = {
	toast,
	success: (msg: string) => toast(msg, "success"),
	error: (msg: string) => toast(msg, "error", 6000),
	warning: (msg: string) => toast(msg, "warning", 5000),
	info: (msg: string) => toast(msg, "info"),
};

export function useToast(): ToastContextValue {
	return ctx;
}
