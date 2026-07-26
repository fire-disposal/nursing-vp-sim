import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import HistoryTabs from "@/components/shell/HistoryTabs";
import PageHeader from "@/components/ui/page-header";

interface RecordSubPageLayoutProps {
	title: string;
	subtitle?: string;
	icon: LucideIcon;
	children: ReactNode;
}

/**
 * Unified layout shell for the four "记录" sub-pages:
 * /history, /stats, /my-responses, /my-feedback.
 *
 * Ensures consistent HistoryTabs + PageHeader + content spacing.
 */
export default function RecordSubPageLayout({
	title,
	subtitle,
	icon,
	children,
}: RecordSubPageLayoutProps) {
	return (
		<div className="space-y-4">
			<HistoryTabs />
			<PageHeader title={title} subtitle={subtitle} icon={icon} />
			{children}
		</div>
	);
}
