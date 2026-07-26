import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import useAuthStore from "@/stores/authStore";
import { cn } from "@/utils/cn";

const RECORD_TABS = [
	{ key: "records", to: "/history", label: "训练记录", permission: null },
	{ key: "stats", to: "/stats", label: "训练统计", permission: "stats_view" as const },
	{ key: "responses", to: "/my-responses", label: "我的问卷", permission: null },
	{ key: "feedback", to: "/my-feedback", label: "我的反馈", permission: null },
] as const;

/**
 * Shared sub-tab bar for the "记录" (History) section.
 *
 * Renders the same four tabs on all four sub-pages
 * (/history, /stats, /my-responses, /my-feedback)
 * so the tab switcher never disappears after navigation.
 *
 * Tabs with permission requirements (e.g. stats_view) are
 * hidden from users who lack the permission, preventing
 * dead-end redirects back to /home → /training.
 */
export default function HistoryTabs() {
	const { pathname } = useLocation();
	const permissions = useAuthStore((s) => s.permissions);

	const visibleTabs = useMemo(
		() =>
			RECORD_TABS.filter(
				(tab) => !tab.permission || permissions.includes(tab.permission),
			),
		[permissions],
	);

	// If only one tab is visible (just records), hide the whole bar
	if (visibleTabs.length <= 1) return null;

	return (
		<nav className="flex gap-1 rounded-lg bg-muted p-1 w-fit overflow-x-auto mb-3">
			{visibleTabs.map((tab) => {
				const active =
					pathname === tab.to ||
					(tab.key !== "records" && pathname.startsWith(tab.to));
				return (
					<Link
						key={tab.key}
						to={tab.to}
						className={cn(
							"inline-flex items-center shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
							active
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{tab.label}
					</Link>
				);
			})}
		</nav>
	);
}
