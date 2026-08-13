import { SegmentedControl } from "@mantine/core";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

interface TabDefinition {
	key: string;
	icon?: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
	label: string;
}

interface LegacyTabsProps {
	tabs: TabDefinition[];
	activeTab: string;
	onChange: (key: string) => void;
	className?: string;
}

function LegacyTabs({ tabs, activeTab, onChange, className }: LegacyTabsProps) {
	return (
		<SegmentedControl
			className={cn(className)}
			value={activeTab}
			onChange={onChange}
			data={tabs.map((tab) => {
				const Icon = tab.icon;
				return {
					value: tab.key,
					label: (
						<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
							{Icon && <Icon size={16} />}
							{tab.label}
						</span>
					),
				};
			})}
		/>
	);
}

export { LegacyTabs };
export default LegacyTabs;
