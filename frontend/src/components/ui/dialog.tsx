import { Group, Modal, Text, ThemeIcon, type ModalProps } from "@mantine/core";
import {
	createContext,
	useContext,
	type CSSProperties,
	type ReactNode,
} from "react";
import Button, { type ButtonProps2 } from "./button";

interface DialogContextValue {
	open: boolean;
	onClose: () => void;
}

const DialogContext = createContext<DialogContextValue>({ open: false, onClose: () => {} });

const SIZE_MAP: Record<string, ModalProps["size"]> = {
	sm: "sm",
	md: "md",
	lg: "lg",
	xl: "xl",
};

interface DialogProps {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children?: ReactNode;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
	return (
		<DialogContext.Provider value={{ open: !!open, onClose: () => onOpenChange?.(false) }}>
			{children}
		</DialogContext.Provider>
	);
}

interface DialogContentProps {
	title?: ReactNode;
	maxWidth?: number | string;
	size?: "sm" | "md" | "lg" | "xl";
	showCloseButton?: boolean;
	className?: string;
	style?: CSSProperties;
	children?: ReactNode;
}

function DialogContent({
	title,
	maxWidth,
	size = "md",
	showCloseButton = true,
	className,
	style,
	children,
}: DialogContentProps) {
	const { open, onClose } = useContext(DialogContext);
	return (
		<Modal
			opened={open}
			onClose={onClose}
			title={title}
			size={maxWidth ?? SIZE_MAP[size]}
			withCloseButton={showCloseButton}
			centered
			className={className}
			styles={{ content: style }}
			withinPortal
		>
			{children}
		</Modal>
	);
}

function DialogTitle({ className, children }: { className?: string; children?: ReactNode }) {
	return (
		<Text fw={600} size="md" className={className}>
			{children}
		</Text>
	);
}

function DialogDescription({ className, children }: { className?: string; children?: ReactNode }) {
	return (
		<Text size="sm" c="dimmed" className={className}>
			{children}
		</Text>
	);
}

function DialogHeader({ className, children }: { className?: string; children?: ReactNode }) {
	return (
		<div className={className} style={{ marginBottom: "0.5rem" }}>
			{children}
		</div>
	);
}

function DialogFooter({ className, children }: { className?: string; children?: ReactNode }) {
	return (
		<Group justify="flex-end" mt="lg" gap="sm" className={className}>
			{children}
		</Group>
	);
}

function DialogMedia({ className, children }: { className?: string; children?: ReactNode }) {
	return (
		<ThemeIcon size={40} radius="md" variant="light" className={className}>
			{children}
		</ThemeIcon>
	);
}

function DialogAction({ className, ...props }: ButtonProps2) {
	return <Button className={className} {...props} />;
}

function DialogCancel({ className, variant = "outline", size = "default", onClick, children, ...props }: ButtonProps2) {
	const { onClose } = useContext(DialogContext);
	return (
		<Button
			variant={variant}
			size={size}
			className={className}
			onClick={(e) => {
				onClick?.(e);
				onClose();
			}}
			{...props}
		>
			{children}
		</Button>
	);
}

function DialogClose({ children }: { children?: ReactNode }) {
	const { onClose } = useContext(DialogContext);
	return (
		<span onClick={onClose} style={{ cursor: "pointer" }}>
			{children}
		</span>
	);
}

function DialogTrigger({ children }: { children?: ReactNode }) {
	return <>{children}</>;
}

export {
	Dialog,
	DialogAction,
	DialogCancel,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogMedia,
	DialogTitle,
	DialogTrigger,
};
