/**
 * Bottomsheet — 通用底部弹出面板
 *
 * 移动端训练页场景工具专用。
 * 支持拖拽调整高度、背景遮罩、关闭按钮。
 */
import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

interface BottomsheetProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
}

export default function Bottomsheet({ open, onClose, title, children }: BottomsheetProps) {
	const sheetRef = useRef<HTMLDivElement>(null);
	const startYRef = useRef(0);
	const translateYRef = useRef(0);

	// Lock body scroll when open
	useEffect(() => {
		if (open) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => { document.body.style.overflow = ""; };
	}, [open]);

	// Keyboard escape
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	const onPointerDown = useCallback((e: React.PointerEvent) => {
		startYRef.current = e.clientY;
		translateYRef.current = 0;
		const el = sheetRef.current;
		if (!el) return;
		el.style.transition = "none";

		const onMove = (ev: PointerEvent) => {
			const dy = ev.clientY - startYRef.current;
			if (dy > 0) {
				translateYRef.current = dy;
				el.style.transform = `translateY(${dy}px)`;
				el.style.opacity = `${Math.max(0.3, 1 - dy / 300)}`;
			}
		};

		const onUp = () => {
			el.style.transition = "";
			el.style.transform = "";
			el.style.opacity = "";
			if (translateYRef.current > 120) onClose();
			document.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerup", onUp);
		};

		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", onUp);
	}, [onClose]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex flex-col justify-end">
			{/* Backdrop */}
			<div className="absolute inset-0 bg-black/40" onClick={onClose} />

			{/* Sheet */}
			<div
				ref={sheetRef}
				className="relative z-10 flex flex-col rounded-t-2xl bg-card shadow-xl max-h-[85vh] transition-transform duration-300"
				style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
			>
				{/* Handle */}
				<div className="flex items-center justify-center pt-2 pb-1 shrink-0">
					<div
						onPointerDown={onPointerDown}
						className="w-10 h-1.5 rounded-full bg-muted-foreground/30 cursor-grab active:cursor-grabbing"
					/>
				</div>

				{/* Header */}
				<div className="flex items-center justify-between px-4 pb-3 shrink-0 border-b border-border">
					<h3 className="text-sm font-semibold">{title}</h3>
					<button
						onClick={onClose}
						className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
						aria-label="关闭"
					>
						<X size={16} />
					</button>
				</div>

				{/* Content — scrollable */}
				<div className="flex-1 overflow-y-auto px-4 py-3">
					{children}
				</div>
			</div>
		</div>
	);
}
