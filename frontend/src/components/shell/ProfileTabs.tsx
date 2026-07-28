import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import useAuthStore from "@/stores/authStore";
import { cn } from "@/lib/utils";

const PROFILE_TABS = [
	{ key: "profile", to: "/profile", label: "个人资料", permission: null },
	{ key: "notifications", to: "/notifications", label: "通知", permission: null },
	{ key: "qa", to: "/qa", label: "护理问答", permission: "qa_access" as const },
] as const;

/**
 * Shared sub-tab bar for the "我的" (Profile) section.
 *
 * Renders on /profile, /notifications, and /qa,
 * ensuring consistent sub-navigation within the third tab group.
 *
 * Tabs with permission requirements are hidden from users
 * who lack them. If only one tab is visible, the bar hides.
 */
export default function ProfileTabs() {
	const { pathname } = useLocation();
	const permissions = useAuthStore((s) => s.permissions);

	const visibleTabs = useMemo(
		() =>
			PROFILE_TABS.filter(
				(tab) => !tab.permission || permissions.includes(tab.permission),
			),
		[permissions],
	);

	if (visibleTabs.length <= 1) return null;

	return (
		<nav className="flex gap-1 rounded-lg bg-muted p-1 w-fit overflow-x-auto mb-3">
			{visibleTabs.map((tab) => {
				const active =
					pathname === tab.to || pathname.startsWith(`${tab.to}/`);
				return (
					<Link
						key={tab.key}
						to={tab.to}
						className={cn(
							"inline-flex items-center shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
							active
								? "bg-background text-foreground shadow-e1"
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
