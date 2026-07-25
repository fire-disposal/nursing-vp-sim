/**
 * Bottomsheet — 通用底部弹出面板（三级态）
 *
 * 移动端训练页场景工具专用。
 * 支持：关闭 → 半屏(40vh) → 全屏(85vh) 三级态切换。
 * 拖拽手势、背景遮罩、关闭按钮。
 *
 * 浏览器兼容性：
 * - Pointer Events (Chrome/Safari/Firefox 均支持)
 * - touch-action: none 防止浏览器手势冲突
 * - transform: translateY() GPU 加速
 * - overscroll-behavior 防止 iOS 橡皮筋
 * - will-change 预提升合成层
 */
import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

interface BottomsheetProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
}

const HALF_VH = 40;
const FULL_VH = 85;
const SNAP_THRESHOLD = 0.12;
const CLOSE_THRESHOLD = 0.25;
const VELOCITY_THRESHOLD = 0.3; // vh per ms

type SnapPoint = "half" | "full";

export default function Bottomsheet({ open, onClose, title, children }: BottomsheetProps) {
	const sheetRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const startYRef = useRef(0);
	const startHeightRef = useRef(0);
	const draggingRef = useRef(false);
	const [snap, setSnap] = useState<SnapPoint>("half");
	const [dragOffset, setDragOffset] = useState(0);
	const lastTimeRef = useRef(0);
	const lastYRef = useRef(0);

	useEffect(() => {
		if (open) {
			document.body.style.overflow = "hidden";
			setSnap("half");
			setDragOffset(0);
			if (contentRef.current) contentRef.current.scrollTop = 0;
		} else {
			document.body.style.overflow = "";
		}
		return () => { document.body.style.overflow = ""; };
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	const targetVh = snap === "half" ? HALF_VH : FULL_VH;
	const currentVh = targetVh - dragOffset;
	const isDragging = draggingRef.current;

	const resolveSnap = useCallback((dyVh: number, velocityVhPerMs: number, fromSnap: SnapPoint): SnapPoint | null => {
		const absDy = Math.abs(dyVh);
		const absVel = Math.abs(velocityVhPerMs);
		const isFast = absVel > VELOCITY_THRESHOLD;

		if (fromSnap === "half") {
			// Half → drag up → full; drag down → close
			if (dyVh < -0.02) {
				if (isFast || absDy > SNAP_THRESHOLD * HALF_VH / 100) return "full";
				return "half";
			}
			if (isFast || absDy > CLOSE_THRESHOLD * HALF_VH / 100) return null;
			return "half";
		}

		// Full → drag down → half or close
		if (dyVh > 0.02) {
			if (isFast || absDy > SNAP_THRESHOLD * FULL_VH / 100) {
				if (absDy > CLOSE_THRESHOLD * FULL_VH / 100) return null;
				return "half";
			}
			return "full";
		}
		return "full";
	}, []);

	const onPointerDown = useCallback((e: React.PointerEvent) => {
		const el = sheetRef.current;
		if (!el) return;
		draggingRef.current = true;
		startYRef.current = e.clientY;
		startHeightRef.current = snap === "half" ? HALF_VH : FULL_VH;
		lastTimeRef.current = Date.now();
		lastYRef.current = e.clientY;
		el.style.transition = "none";
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}, [snap]);

	const onPointerMove = useCallback((e: React.PointerEvent) => {
		if (!draggingRef.current) return;
		const now = Date.now();
		const dyPx = e.clientY - startYRef.current;
		const vhPerPx = 100 / window.innerHeight;
		const dyVh = dyPx * vhPerPx;
		setDragOffset(dyVh);
		lastTimeRef.current = now;
		lastYRef.current = e.clientY;
	}, []);

	const onPointerUp = useCallback((e: React.PointerEvent) => {
		if (!draggingRef.current) return;
		draggingRef.current = false;
		const el = sheetRef.current;
		if (!el) return;
		el.style.transition = "";

		const dt = Date.now() - lastTimeRef.current || 1;
		const dpPx = e.clientY - lastYRef.current;
		const vhPerPx = 100 / window.innerHeight;
		const velocityVhPerMs = (dpPx * vhPerPx) / dt;
		const totalDyVh = (e.clientY - startYRef.current) * vhPerPx;

		const nextSnap = resolveSnap(totalDyVh, velocityVhPerMs, snap);
		setDragOffset(0);
		if (nextSnap === null) {
			onClose();
		} else {
			setSnap(nextSnap);
		}
	}, [snap, resolveSnap, onClose]);

	const handleBackdropClick = useCallback(() => {
		if (snap === "half") {
			setSnap("full");
		} else {
			onClose();
		}
	}, [snap, onClose]);

	if (!open) return null;

	const backdropOpacity = snap === "half" ? 0.25 : 0.45;

	return (
		<div className="fixed inset-0 z-50 flex flex-col justify-end">
			<div
				className="absolute inset-0 transition-opacity duration-300"
				style={{ background: `rgba(0,0,0,${backdropOpacity})` }}
				onClick={handleBackdropClick}
			/>

			<div
				ref={sheetRef}
				className="relative z-10 flex flex-col rounded-t-2xl bg-card shadow-xl will-change-transform"
				style={{
					height: `calc(${currentVh}vh + env(safe-area-inset-bottom, 0px))`,
					transition: isDragging ? "none" : "height 350ms cubic-bezier(0.32, 0.72, 0, 1)",
					paddingBottom: "env(safe-area-inset-bottom, 0px)",
				}}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onLostPointerCapture={onPointerUp}
			>
			<div
				className="flex items-center justify-center pt-2.5 pb-1.5 shrink-0 cursor-grab active:cursor-grabbing"
				style={{ touchAction: "none" }}
				onPointerDown={onPointerDown}
			>
				<div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
			</div>

				<div className="flex items-center justify-between px-4 pb-3 shrink-0 border-b border-border">
					<h3 className="text-sm font-semibold select-none">{title}</h3>
					<button
						onClick={(e) => { e.stopPropagation(); onClose(); }}
						className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
						aria-label="关闭"
					>
						<X size={16} />
					</button>
				</div>

				<div
					ref={contentRef}
					className="flex-1 overflow-y-auto px-4 py-3 overscroll-contain"
				>
					{children}
				</div>
			</div>
		</div>
	);
}
