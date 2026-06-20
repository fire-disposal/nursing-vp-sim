/* FloatingPanelHost — floating icon bar + modal-based panel overlay.
 * Replaces the old side-panel PanelHost. Chat area gets full width;
 * panels are accessed via floating icons and open as centered modals. */

import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { PanelPlugin, PluginContext } from "@/engine/types";
import { useIsMobile } from "@/hooks/useLayoutMode";
import { cn } from "@/lib/utils";

interface FloatingPanelHostProps {
	ctx: PluginContext;
	features: Record<string, boolean>;
	plugins: PanelPlugin[];
}

/* ── Auto-hide idle timer — bar fades after 8s idle ── */
function useBarAutoHide() {
	const [visible, setVisible] = useState(true);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const poke = useCallback(() => {
		setVisible(true);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setVisible(false), 8_000);
	}, []);

	useEffect(() => {
		poke();
		return () => clearTimeout(timer.current);
	}, [poke]);

	return { visible, poke };
}

/* ── FloatingPanelHost ── */
export function FloatingPanelHost({ ctx, features, plugins }: FloatingPanelHostProps) {
	const [activePanelId, setActivePanelId] = useState<string | null>(null);
	const isMobile = useIsMobile();

	const activePlugin = plugins.find((p) => p.id === activePanelId);

	/* Auto-hide the icon bar when idle */
	const { visible, poke } = useBarAutoHide();

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
		poke();
	}, [poke]);

	const closePanel = useCallback(() => {
		setActivePanelId(null);
		poke();
	}, [poke]);

	if (plugins.length === 0) return null;

	return (
		<>
			{/* Floating icon bar — bottom-right, auto-fades when idle */}
			<div
				className="fixed bottom-24 right-3 z-40 flex flex-col gap-1.5 transition-opacity duration-500"
				style={{ opacity: visible ? 1 : 0.2 }}
				onMouseEnter={poke}
			>
				{plugins.map((plugin) => {
					const badge = plugin.tab.badge?.(ctx);
					return (
						<button
							key={plugin.id}
							onClick={() => openPanel(plugin.id)}
							className={cn(
								"relative flex size-10 items-center justify-center rounded-full shadow-lg border transition-all duration-200",
								"hover:scale-110 active:scale-95",
								activePanelId === plugin.id
									? "bg-primary text-primary-foreground border-primary shadow-primary/30"
									: "bg-background text-muted-foreground border-border hover:text-foreground hover:border-primary/40",
							)}
							title={plugin.tab.label}
						>
							<plugin.tab.icon size={18} />
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
						</button>
					);
				})}
			</div>

			{/* Panel modal overlay */}
			{activePanelId && activePlugin && (
				<PanelOverlay
					isMobile={isMobile}
					label={activePlugin.tab.label}
					onClose={closePanel}
				>
					<activePlugin.component
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
