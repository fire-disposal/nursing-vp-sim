import { AlertTriangle } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";
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

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm(): ConfirmContextType {
	const ctx = useContext(ConfirmContext);
	if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
	return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<
		(ConfirmOptions & { open: boolean }) | null
	>(null);
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

	return (
		<ConfirmContext.Provider value={{ confirm }}>
			{children}
			<ConfirmDialogView
				open={state?.open ?? false}
				title={state?.title ?? ""}
				message={state?.message ?? ""}
				confirmLabel={state?.confirmLabel}
				cancelLabel={state?.cancelLabel}
				danger={state?.danger}
				onConfirm={() => handleClose(true)}
				onCancel={() => handleClose(false)}
			/>
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
