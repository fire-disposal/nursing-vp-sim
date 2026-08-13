import { Box, Group } from "@mantine/core";
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import useAuthStore from "@/stores/authStore";

const PROFILE_TABS = [
	{ key: "profile", to: "/profile", label: "个人资料", permission: null },
	{ key: "notifications", to: "/notifications", label: "通知", permission: null },
	{ key: "feedback", to: "/my-feedback", label: "我的反馈", permission: null },
] as const;

/**
 * Shared sub-tab bar for the "我的" (Profile) section.
 *
 * Renders on /profile, /notifications, and /my-feedback,
 * keeping account-owned pages grouped together.
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
		<Box
			component="nav"
			p={4}
			mb="sm"
			style={{
				background: "var(--mantine-color-gray-1)",
				borderRadius: "var(--mantine-radius-md)",
				width: "fit-content",
				overflowX: "auto",
			}}
		>
			<Group gap={4} wrap="nowrap">
				{visibleTabs.map((tab) => {
					const active =
						pathname === tab.to || pathname.startsWith(`${tab.to}/`);
					return (
						<Link key={tab.key} to={tab.to} style={{ textDecoration: "none" }}>
							<Box
								px="sm"
								py={6}
								style={{
									borderRadius: "var(--mantine-radius-sm)",
									background: active ? "var(--mantine-color-body)" : undefined,
									color: active
										? "var(--mantine-color-text)"
										: "var(--mantine-color-dimmed)",
									fontSize: 14,
									fontWeight: 500,
									whiteSpace: "nowrap",
									boxShadow: active ? "var(--mantine-shadow-xs)" : undefined,
								}}
							>
								{tab.label}
							</Box>
						</Link>
					);
				})}
			</Group>
		</Box>
	);
}
