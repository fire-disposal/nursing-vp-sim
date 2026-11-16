import { Button, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getApiErrorMessage } from "@/utils/error";

type ToastType = "success" | "error" | "warning" | "info";

type ToastOptions = {
	description?: string;
	action?: { label: string; onClick: () => void };
};

interface ToastApi {
	toast: (message: string, type?: ToastType, duration?: number, options?: ToastOptions) => string;
	success: (msg: string, options?: ToastOptions & { duration?: number }) => string;
	error: (msg: string, options?: ToastOptions & { duration?: number }) => string;
	warning: (msg: string, options?: ToastOptions & { duration?: number }) => string;
	info: (msg: string, options?: ToastOptions & { duration?: number }) => string;
	apiError: (e: unknown, fallback?: string) => string;
}

const COLOR: Record<ToastType, string> = {
	success: "green",
	error: "red",
	warning: "yellow",
	info: "blue",
};

/**
 * 同一 `type + message` 只保留一条：Mantine 用 id 去重，重复触发只刷新计时。
 * 旧实现按自增序号发 id，同一个错误连点两次就变两条，队列上限 5 一满就开始挤掉真正的新消息。
 */
function show(
	message: string,
	type: ToastType = "info",
	duration = 4000,
	options?: ToastOptions,
): string {
	const id = `toast:${type}:${message}`;
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
	return id;
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
