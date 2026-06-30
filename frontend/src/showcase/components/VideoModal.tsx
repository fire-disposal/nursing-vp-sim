import { X } from "lucide-react";
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
			className="fixed inset-0 z-50 m-auto max-h-[90vh] max-w-[90vw] rounded-2xl border border-border/60 bg-card p-0 shadow-2xl backdrop:bg-background/70"
			onClick={(e) => {
				if (e.target === dialogRef.current) onClose();
			}}
		>
			<div className="relative">
				<button
					type="button"
					onClick={onClose}
					className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-background/80 text-foreground/60 backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground"
				>
					<X size={16} strokeWidth={2} />
				</button>
				<video
					src={src}
					controls
					autoPlay
					className="max-h-[85vh] w-full rounded-2xl"
				>
					<track kind="captions" src="" default />
				</video>
			</div>
		</dialog>
	);
}
