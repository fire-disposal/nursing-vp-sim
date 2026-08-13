import { Box, Group, Text } from "@mantine/core";
import { IconLogout, IconMessageCirclePlus, IconStethoscope } from "@tabler/icons-react";
import { NavLink, useLocation } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import Button from "@/components/ui/button";
import NotificationBell from "@/components/NotificationBell";
import type { NavItem } from "./navigation";
import { useShortViewport } from "@/hooks/useShortViewport";

/** 子页面路径前缀映射 — 确保进入子页面时父级 Tab 保持高亮 */
const TAB_SUB_PATHS: Record<string, string[]> = {
	"/history": ["/record"],
	"/profile": ["/notifications", "/my-feedback"],
};

function isLinkActive(pathname: string, link: NavItem): boolean {
	if (link.end) return pathname === link.to;
	if (pathname === link.to || pathname.startsWith(`${link.to}/`)) return true;
	const subs = TAB_SUB_PATHS[link.to];
	if (subs) return subs.some((p) => pathname === p || pathname.startsWith(`${p}/`));
	return false;
}

/**
 * 桌面端显示水平导航链接（4 项：训练 | 记录 | 问答 | 我的）。
 * 登出和主题切换已移至 Profile 页面。
 */
export function StudentTopNav({ links, onLogout }: { links: NavItem[]; onLogout: () => void }) {
	const { openFeedback } = useFeedback();
	const { pathname } = useLocation();
	const isShort = useShortViewport();

	return (
		<Box
			component="header"
			style={{
				flexShrink: 0,
				borderBottom: "1px solid var(--mantine-color-gray-3)",
				background: "var(--mantine-color-body)",
			}}
		>
			<Group gap={8} px="xs" wrap="nowrap" h={isShort ? 32 : { base: 40, sm: 56 }}>
				{/* Brand */}
				<Group gap={8} wrap="nowrap">
					<Box
						style={{
							width: 28,
							height: 28,
							borderRadius: "var(--mantine-radius-md)",
							background: "var(--mantine-color-teal-6)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<IconStethoscope size={14} style={{ color: "white" }} />
					</Box>
					<Text size="sm" fw={600}>
						虚拟患者系统
					</Text>
				</Group>

				{/* Nav links (desktop only) */}
				<Group gap={2} visibleFrom="sm" wrap="nowrap" style={{ flex: 1 }} ml={8}>
					{links.map((link) => {
						const Icon = link.icon;
						const active = isLinkActive(pathname, link);
						return (
							<NavLink
								key={link.to}
								to={link.to}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 6,
									padding: "6px 12px",
									borderRadius: "var(--mantine-radius-md)",
									fontSize: 14,
									fontWeight: 500,
									textDecoration: "none",
									color: active ? "var(--mantine-color-teal-6)" : "var(--mantine-color-dimmed)",
									background: active ? "var(--mantine-color-teal-light)" : undefined,
								}}
							>
								<Icon size={16} />
								{link.shortLabel ?? link.label}
							</NavLink>
						);
					})}
				</Group>

				{/* Right side — utility icons */}
				<Group gap={2} wrap="nowrap" style={{ marginLeft: "auto" }}>
					<Button
						variant="ghost"
						size="sm"
						leftSection={<IconMessageCirclePlus size={14} />}
						onClick={openFeedback}
						aria-label="意见反馈"
					>
						<Text component="span" visibleFrom="sm">
							反馈
						</Text>
					</Button>
					<NotificationBell />
					<Button variant="ghost" size="icon-sm" onClick={onLogout} aria-label="退出登录">
						<IconLogout size={14} />
					</Button>
				</Group>
			</Group>
		</Box>
	);
}
