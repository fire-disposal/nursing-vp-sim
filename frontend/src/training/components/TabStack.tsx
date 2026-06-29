import { useState, type ReactNode } from "react";

export interface TabDef {
	id: string;
	icon: ReactNode;
	label: string;
	badge?: number | string;
	panel: ReactNode;
}

interface Props {
	tabs: TabDef[];
	side?: "right" | "left";
}

export default function TabStack({ tabs, side = "right" }: Props) {
	const [active, setActive] = useState<string | null>(null);
	const activeTab = tabs.find((t) => t.id === active);

	return (
		<div className="relative h-full flex">
			<div
				className={`flex flex-col gap-1 py-4 px-1.5 bg-muted/30 border-${side === "right" ? "l" : "r"} ${side === "right" ? "order-last" : ""}`}
			>
				{tabs.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActive(active === tab.id ? null : tab.id)}
						className={`relative flex flex-col items-center gap-0.5 w-12 py-2.5 rounded-lg transition-all ${
							active === tab.id
								? "bg-primary/10 text-primary shadow-sm"
								: "text-muted-foreground hover:bg-muted hover:text-foreground"
						}`}
						title={tab.label}
					>
						<span className="[&>svg]:size-5">{tab.icon}</span>
						<span className="text-[10px] font-medium leading-tight text-center">{tab.label}</span>
						{tab.badge !== undefined && (
							<span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1">
								{tab.badge}
							</span>
						)}
					</button>
				))}
			</div>

			{activeTab && (
				<div className={`w-80 overflow-y-auto border-${side === "right" ? "l" : "r"} bg-background`}>
					<div className="p-4">{activeTab.panel}</div>
				</div>
			)}
		</div>
	);
}
