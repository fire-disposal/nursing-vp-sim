import { Button, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
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

const COLOR: Record<ToastType, string> = {
	success: "teal",
	error: "red",
	warning: "yellow",
	info: "blue",
};

let _nextId = 0;

function show(
	message: string,
	type: ToastType = "info",
	duration = 4000,
	options?: ToastOptions,
): number {
	_nextId += 1;
	const id = `toast-${_nextId}`;
	const { description, action } = options ?? {};

	const body =
		description || action ? (
			<>
				{description ? (
					<Text size="sm" c="dimmed">
						{description}
					</Text>
				) : null}
				{action ? (
					<Button
						variant="light"
						size="compact-xs"
						mt={description ? 8 : 0}
						onClick={() => {
							action.onClick();
							notifications.hide(id);
						}}
					>
						{action.label}
					</Button>
				) : null}
			</>
		) : undefined;

	notifications.show({
		id,
		title: message,
		message: body,
		color: COLOR[type],
		autoClose: duration === 0 ? false : duration,
		withCloseButton: true,
	});
	return _nextId;
}

export const toast: ToastApi = {
	toast: show,
	success: (msg, opts) => show(msg, "success", opts?.duration ?? 6000, opts),
	error: (msg, opts) => show(msg, "error", opts?.duration ?? 6000, opts),
	warning: (msg, opts) => show(msg, "warning", opts?.duration ?? 5000, opts),
	info: (msg, opts) => show(msg, "info", opts?.duration ?? 4000, opts),
	apiError: (e, fallback = "操作失败") => show(getApiErrorMessage(e, fallback), "error", 6000),
};

export function useToast(): ToastApi {
	return toast;
}
