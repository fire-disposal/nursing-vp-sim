import { IconX } from "@tabler/icons-react";
import { useEffect, useRef } from "react";

interface VideoModalProps {
	open: boolean;
	onClose: () => void;
	src: string;
}

export default function VideoModal({ open, onClose, src }: VideoModalProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		if (!open && el.open) el.close();
	}, [open]);

	useEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		const handler = () => onClose();
		el.addEventListener("close", handler);
		return () => el.removeEventListener("close", handler);
	}, [onClose]);

	if (!open) return null;

	return (
		<dialog
			ref={dialogRef}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 50,
				margin: "auto",
				maxHeight: "90vh",
				maxWidth: "90vw",
				borderRadius: "var(--mantine-radius-md)",
				border: "1px solid var(--mantine-color-default-border)",
				background: "var(--mantine-color-body)",
				padding: 0,
				boxShadow: "var(--mantine-shadow-xl)",
			}}
			onClick={(e) => {
				if (e.target === dialogRef.current) onClose();
			}}
		>
			<div style={{ position: "relative" }}>
				<button
					type="button"
					onClick={onClose}
					style={{
						position: "absolute",
						right: 12,
						top: 12,
						zIndex: 10,
						display: "flex",
						width: 32,
						height: 32,
						alignItems: "center",
						justifyContent: "center",
						borderRadius: "50%",
						border: "none",
						background: "var(--mantine-color-body)",
						color: "var(--mantine-color-dimmed)",
						cursor: "pointer",
						backdropFilter: "blur(4px)",
					}}
				>
					<IconX size={16} strokeWidth={2} />
				</button>
				<video
					src={src}
					controls
					autoPlay
					style={{
						maxHeight: "85vh",
						width: "100%",
						borderRadius: "var(--mantine-radius-md)",
					}}
				>
					<track kind="captions" src="" default />
				</video>
			</div>
		</dialog>
	);
}
