/* FloatingPanelHost — floating mini sidebar + modal-based panel overlay.
 *
 * Replaces the old floating-icon-only design. Shows icon + label in a
 * compact vertical bar at the bottom-right. No auto-hide — always visible.
 * Hover expands the bar slightly; panel labels are always shown.
 */

import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { PanelDef, PanelContext } from "@/engine/types";
import { useIsMobile } from "@/hooks/useLayoutMode";
import { cn } from "@/utils/cn";

interface FloatingPanelHostProps {
	ctx: PanelContext;
	features: Record<string, boolean>;
	panels: PanelDef[];
}

/* ── FloatingPanelHost ── */
export function FloatingPanelHost({ ctx, features, panels }: FloatingPanelHostProps) {
	const [activePanelId, setActivePanelId] = useState<string | null>(null);
	const [hoveredPanel, setHoveredPanel] = useState<string | null>(null);
	const isMobile = useIsMobile();

	const activePanel = panels.find((p) => p.id === activePanelId);

	/* Close modal when user sends a message */
	const wasSending = useRef(ctx.loading);
	useEffect(() => {
		if (wasSending.current && !ctx.loading) {
			setActivePanelId(null);
		}
		wasSending.current = ctx.loading;
	}, [ctx.loading]);

	const openPanel = useCallback((id: string) => {
		setActivePanelId((prev) => (prev === id ? null : id));
	}, []);

	const closePanel = useCallback(() => {
		setActivePanelId(null);
	}, []);

	if (panels.length === 0) return null;

	return (
		<>
			{/* Floating mini sidebar — bottom-right, always visible */}
			<div
				className="fixed bottom-24 right-3 z-40 flex flex-col gap-0.5"
			>
				{/* Label header */}
				<div className="hidden md:block text-[10px] uppercase tracking-wider text-muted-foreground/60 text-center mb-1 select-none">
					面板
				</div>
				{panels.map((panel) => {
					const badge = panel.tab.badge?.(ctx);
					const isHovered = hoveredPanel === panel.id;
					const isActive = activePanelId === panel.id;

					return (
						<button type="button"
							key={panel.id}
							className={cn(
								"relative flex items-center gap-2 rounded-lg transition-all duration-200 cursor-pointer select-none",
								"hover:bg-accent/60",
								isActive && "bg-accent",
							)}
							onMouseEnter={() => setHoveredPanel(panel.id)}
							onMouseLeave={() => setHoveredPanel(null)}
							onClick={() => openPanel(panel.id)}
							aria-label={panel.tab.label}
						>
							{/* Icon circle */}
							<div
								className={cn(
									"relative flex size-10 shrink-0 items-center justify-center rounded-full shadow-lg border transition-all duration-200",
									"hover:scale-110 active:scale-95",
									isActive
										? "bg-primary text-primary-foreground border-primary shadow-primary/30"
										: "bg-background text-muted-foreground border-border hover:text-foreground hover:border-primary/40",
								)}
							>
								<panel.tab.icon size={18} />
								{badge && (
									<span
										className={cn(
											"absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1 leading-none shadow-sm",
											badge.variant === "destructive"
												? "bg-destructive text-destructive-foreground"
												: "bg-primary text-primary-foreground",
										)}
									>
										{badge.text}
									</span>
								)}
							</div>

							{/* Label — always visible on desktop */}
							<span
								className={cn(
									"text-xs font-medium transition-all duration-200 select-none",
									"hidden md:block",
									isActive
										? "text-foreground"
										: "text-muted-foreground",
								)}
							>
								{panel.tab.label}
							</span>

							{/* Tooltip for mobile */}
							<span
								className={cn(
									"absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap",
									"rounded-md bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-lg border border-border",
									"md:hidden",
									"transition-opacity duration-150 pointer-events-none",
									isHovered ? "opacity-100" : "opacity-0",
								)}
							>
								{panel.tab.label}
							</span>
						</button>
					);
				})}
			</div>

			{/* Panel modal overlay */}
			{activePanelId && activePanel && (
				<PanelOverlay
					isMobile={isMobile}
					label={activePanel.tab.label}
					onClose={closePanel}
				>
					<activePanel.component
						ctx={ctx}
						features={features}
						isCollapsed={false}
					/>
				</PanelOverlay>
			)}
		</>
	);
}

/* ── PanelOverlay — animated modal/sheet wrapper ── */
interface PanelOverlayProps {
	children: React.ReactNode;
	label: string;
	isMobile: boolean;
	onClose: () => void;
}

function PanelOverlay({ children, label, isMobile, onClose }: PanelOverlayProps) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		requestAnimationFrame(() => setOpen(true));
	}, []);

	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex",
				isMobile ? "items-end" : "items-center justify-center",
			)}
		>
			{/* Backdrop */}
			<div
				className={cn(
					"absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-200",
					open ? "opacity-100" : "opacity-0",
				)}
				onClick={onClose}
			/>

			{/* Panel content */}
			<div
				className={cn(
					"relative z-10 bg-card shadow-2xl overflow-hidden flex flex-col transition-all duration-300",
					isMobile
						? "fixed bottom-0 left-0 right-0 rounded-t-2xl max-h-[85vh]"
						: "rounded-xl max-w-2xl w-[90vw] max-h-[85vh]",
					open
						? isMobile
							? "translate-y-0 opacity-100"
							: "scale-100 opacity-100 translate-y-0"
						: isMobile
							? "translate-y-full opacity-0"
							: "scale-95 opacity-0 translate-y-4",
				)}
			>
				{/* Header bar */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
					<h3 className="text-sm font-semibold text-foreground">
						{label}
					</h3>
					<button
						onClick={onClose}
						className="size-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
						aria-label="关闭面板"
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<title>关闭面板</title>
							<path d="M4 4l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						</svg>
					</button>
				</div>

				{/* Panel body */}
				<div className="flex-1 overflow-y-auto p-4">
					{children}
				</div>
			</div>
		</div>
	);
}
