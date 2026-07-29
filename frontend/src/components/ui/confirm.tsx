import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { useConfirmStore } from "@/stores/confirmStore";
import {
	Dialog,
	DialogAction,
	DialogCancel,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogMedia,
	DialogTitle,
} from "@/components/ui/dialog";

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

interface ConfirmDialogProps extends ConfirmOptions {
	open: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

function ConfirmDialogView({
	open,
	onConfirm,
	onCancel,
	title,
	message,
	confirmLabel = "确定",
	cancelLabel = "取消",
	danger = false,
}: ConfirmDialogProps) {
	return (
		<Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
			<DialogContent variant="confirm" size="md">
				<DialogHeader>
					<DialogMedia className={danger ? "bg-danger" : "bg-warning"}>
						<AlertTriangle
							size={20}
							className={
								danger ? "text-danger-foreground" : "text-warning-foreground"
							}
						/>
					</DialogMedia>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{message}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogCancel onClick={onCancel}>{cancelLabel}</DialogCancel>
					<DialogAction
						onClick={onConfirm}
						className={
							danger
								? "bg-destructive text-white hover:bg-destructive/90"
								: undefined
						}
					>
						{confirmLabel}
					</DialogAction>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function useConfirm(): ConfirmContextType {
	const confirm = useConfirmStore((s) => s.confirm);
	return { confirm };
}

export function ConfirmHost() {
	const current = useConfirmStore((s) => s.current);
	const closeConfirm = useConfirmStore((s) => s.closeConfirm);

	return (
		<ConfirmDialogView
			open={current != null}
			title={current?.title ?? ""}
			message={current?.message ?? ""}
			confirmLabel={current?.confirmLabel}
			cancelLabel={current?.cancelLabel}
			danger={current?.danger}
			onConfirm={() => closeConfirm(true)}
			onCancel={() => closeConfirm(false)}
		/>
	);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
	return (
		<>
			{children}
			<ConfirmHost />
		</>
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
		<ConfirmDialogView
			open={open}
			onConfirm={onConfirm}
			onCancel={onCancel}
			title={title}
			message={message}
			confirmLabel={confirmLabel}
			cancelLabel={cancelLabel}
			danger={danger}
		/>
	);
}
