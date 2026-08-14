import { modals } from "@mantine/modals";

import { Button, Group, Modal } from "@mantine/core";

export interface ConfirmOptions {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

interface ConfirmContextType {
	confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

function openConfirm(opts: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		modals.openConfirmModal({
			title: opts.title,
			children: opts.message,
			labels: {
				confirm: opts.confirmLabel ?? "确定",
				cancel: opts.cancelLabel ?? "取消",
			},
			color: opts.danger ? "red" : undefined,
			onConfirm: () => resolve(true),
			onCancel: () => resolve(false),
		});
	});
}

export function useConfirm(): ConfirmContextType {
	return { confirm: openConfirm };
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
		<Modal opened={open} onClose={onCancel} title={title} size="sm" centered withinPortal>
			{message}
			<Group justify="flex-end" gap={8} mt="md">
				<Button variant="outline" onClick={onCancel}>
					{cancelLabel}
				</Button>
				<Button variant={danger ? "light" : "filled"} color={danger ? "red" : undefined} onClick={onConfirm}>
					{confirmLabel}
				</Button>
			</Group>
		</Modal>
	);
}
