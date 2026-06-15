import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { PanelPlugin, PluginContext } from "@/engine/types";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

interface PanelHostProps {
	ctx: PluginContext;
	features: Record<string, boolean>;
	plugins: PanelPlugin[];
}

export function PanelHost({ ctx, features, plugins }: PanelHostProps) {
	const [activeTabId, setActiveTabId] = useState<string | null>(
		plugins[0]?.id ?? null,
	);
	const [isCollapsed, setIsCollapsed] = useState(false);
	const isMobile = useIsMobile();

	const activePlugin = plugins.find((p) => p.id === activeTabId);

	useEffect(() => {
		if (plugins.length > 0 && activeTabId === null) {
			setActiveTabId(plugins[0].id);
		}
	}, [plugins, activeTabId]);

	useEffect(() => {
		if (isMobile && !isCollapsed) {
			document.body.style.overflow = "hidden";
			return () => {
				document.body.style.overflow = "";
			};
		}
	}, [isMobile, isCollapsed]);

	const handleTabClick = (pluginId: string) => {
		if (isCollapsed) {
			setIsCollapsed(false);
			setActiveTabId(pluginId);
		} else if (activeTabId === pluginId) {
			setIsCollapsed(true);
		} else {
			setActiveTabId(pluginId);
		}
	};

	if (isMobile && activePlugin && !isCollapsed) {
		return (
			<div className="fixed inset-0 z-50 flex flex-col bg-background">
				<div className="flex items-center gap-2 border-b px-4 py-3 overflow-x-auto">
					{plugins.map((p) => (
						<button
							key={p.id}
							onClick={() => setActiveTabId(p.id)}
							className={cn(
								"flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors",
								activeTabId === p.id
									? "bg-primary/10 text-primary"
									: "text-muted-foreground hover:bg-muted",
							)}
						>
							<p.tab.icon size={14} />
							{p.tab.label}
						</button>
					))}
					<button
						onClick={() => setIsCollapsed(true)}
						className="ml-auto size-8 flex items-center justify-center rounded-md hover:bg-muted shrink-0"
					>
						<ChevronRight size={18} />
					</button>
				</div>
				<div className="flex-1 overflow-y-auto p-4">
					<h3 className="text-sm font-semibold mb-3">
						{activePlugin.tab.label}
					</h3>
					<activePlugin.component
						ctx={ctx}
						features={features}
						isCollapsed={false}
					/>
				</div>
			</div>
		);
	}

	if (plugins.length === 0) return null;

	return (
		<div
			className={cn(
				"flex h-full border-l border-border bg-card transition-all duration-200",
				isCollapsed ? "w-10" : "w-[420px]",
			)}
		>
			<div className="flex flex-col gap-0.5 p-1 shrink-0">
				<button
					onClick={() => setIsCollapsed((v) => !v)}
					className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
					title={isCollapsed ? "展开面板" : "折叠面板"}
				>
					{isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
				</button>

				{plugins.map((plugin) => {
					const badge = plugin.tab.badge?.(ctx);
					return (
						<button
							key={plugin.id}
							onClick={() => handleTabClick(plugin.id)}
							className={cn(
								"size-9 rounded-lg flex items-center justify-center transition-colors relative",
								activeTabId === plugin.id && !isCollapsed
									? "bg-primary/10 text-primary"
									: "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
							title={plugin.tab.label}
						>
							<plugin.tab.icon size={18} />
							{badge && (
								<span
									className={cn(
										"absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold px-1",
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

			{!isCollapsed && activePlugin && (
				<div className="flex-1 border-l border-border bg-card overflow-hidden flex flex-col">
					<div className="shrink-0 px-3 py-2.5 border-b border-border">
						<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
							{activePlugin.tab.label}
						</h3>
					</div>
					<div className="flex-1 overflow-y-auto p-3">
						<activePlugin.component
							ctx={ctx}
							features={features}
							isCollapsed={false}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
