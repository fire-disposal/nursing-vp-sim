import { Stack } from "@mantine/core";
import type { ComponentType, ReactNode } from "react";
import PageHeader from "@/components/ui/page-header";

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

interface RecordSubPageLayoutProps {
	title: string;
	subtitle?: string;
	icon: IconType;
	children: ReactNode;
}

/**
 * Unified layout shell for record-owned pages.
 *
 * Feedback lives under "我的", so this shell only wraps training records.
 */
export default function RecordSubPageLayout({
	title,
	subtitle,
	icon,
	children,
}: RecordSubPageLayoutProps) {
	return (
		<Stack gap="md">
			<PageHeader title={title} subtitle={subtitle} icon={icon} />
			{children}
		</Stack>
	);
}
