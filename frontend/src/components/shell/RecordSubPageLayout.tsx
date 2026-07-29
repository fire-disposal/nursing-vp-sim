import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import PageHeader from "@/components/ui/page-header";

interface RecordSubPageLayoutProps {
	title: string;
	subtitle?: string;
	icon: LucideIcon;
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
		<div className="space-y-4">
			<PageHeader title={title} subtitle={subtitle} icon={icon} />
			{children}
		</div>
	);
}
