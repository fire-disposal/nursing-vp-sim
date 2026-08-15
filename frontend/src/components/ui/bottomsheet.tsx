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
import { ActionIcon, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
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
const CLOSE_THRESHOLD = 0.35;
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
		<div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
			<div
				style={{ position: "absolute", inset: 0, transition: "opacity 300ms", background: `rgba(0,0,0,${backdropOpacity})` }}
				onClick={handleBackdropClick}
			/>

			<div
				ref={sheetRef}
				style={{
					position: "relative",
					zIndex: 10,
					display: "flex",
					flexDirection: "column",
					borderTopLeftRadius: "1rem",
					borderTopRightRadius: "1rem",
					background: "var(--mantine-color-body)",
					boxShadow: "var(--mantine-shadow-xl)",
					willChange: "transform",
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
					style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 10, paddingBottom: 6, flexShrink: 0, cursor: "grab", touchAction: "none" }}
					onPointerDown={onPointerDown}
				>
					<div style={{ width: 40, height: 6, borderRadius: 999, background: "var(--mantine-color-dimmed)", opacity: 0.3 }} />
				</div>

				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 16, paddingBottom: 12, flexShrink: 0, borderBottom: "1px solid var(--mantine-color-default-border)" }}>
					<Text size="sm" fw={600} style={{ userSelect: "none" }}>
						{title}
					</Text>
					<ActionIcon
						variant="subtle"
						color="gray"
						size="md"
						radius="md"
						onClick={(e) => { e.stopPropagation(); onClose(); }}
						aria-label="关闭"
					>
						<IconX size={18} />
					</ActionIcon>
				</div>

				<div
					ref={contentRef}
					style={{ flex: 1, overflowY: "auto", paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, overscrollBehavior: "contain" }}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
