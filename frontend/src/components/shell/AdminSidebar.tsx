import { Box, Button, Group, Text } from "@mantine/core";
import { IconLogout, IconMessageCirclePlus, IconStethoscope } from "@tabler/icons-react";
import { memo, useMemo, type CSSProperties } from "react";
import { NavLink } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { NavGroup } from "@/components/ui/nav-group";
import { Separator } from "@/components/ui/separator";
import NotificationBell from "@/components/NotificationBell";
import type { NavGroupKey, NavItem } from "./navigation";
import { NAV_GROUPS } from "./navigation";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";
import { useIsMobile } from "@/hooks/useLayoutMode";
import { APP_VERSION } from "@/version";

const navLinkStyle = (isActive: boolean): CSSProperties => ({
	display: "flex",
	alignItems: "center",
	gap: 10,
	borderRadius: "var(--mantine-radius-md)",
	padding: "8px 12px",
	marginBottom: 2,
	fontSize: 14,
	fontWeight: 500,
	textDecoration: "none",
	color: isActive ? "var(--mantine-color-teal-6)" : "var(--mantine-color-dimmed)",
	background: isActive ? "var(--mantine-color-teal-light)" : undefined,
});

const SidebarNav = memo(function SidebarNav({
	userLinks,
	adminLinks,
	close,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	close: () => void;
}) {
	const { grouped, ungrouped } = useMemo(() => {
		const g = new Map<NavGroupKey, NavItem[]>();
		const u: NavItem[] = [];
		for (const link of adminLinks) {
			if (link.group) {
				if (!g.has(link.group)) g.set(link.group, []);
				g.get(link.group)!.push(link);
			} else {
				u.push(link);
			}
		}
		return { grouped: g, ungrouped: u };
	}, [adminLinks]);

	return (
		<>
			{userLinks.map((link) => {
				const Icon = link.icon;
				return (
					<NavLink key={link.to} to={link.to} end={link.end} onClick={close} style={({ isActive }) => navLinkStyle(isActive)}>
						<Icon size={17} />
						{link.label}
					</NavLink>
				);
			})}
			{ungrouped.length > 0 && (
				<>
					<Separator my="xs" />
					{ungrouped.map((link) => {
						const Icon = link.icon;
						return (
							<NavLink key={link.to} to={link.to} end={link.end} onClick={close} style={({ isActive }) => navLinkStyle(isActive)}>
								<Icon size={17} />
								{link.label}
							</NavLink>
						);
					})}
				</>
			)}
			{grouped.size > 0 && (
				<>
					<Separator my="xs" />
					{NAV_GROUPS.map((group) => {
						const links = grouped.get(group.key);
						if (!links || links.length === 0) return null;
						return (
							<NavGroup
								key={group.key}
								label={group.label}
								icon={group.icon}
								defaultOpen={group.defaultOpen}
								storageKey={group.key}
							>
								{links.map((link) => {
									const Icon = link.icon;
									return (
										<NavLink key={link.to} to={link.to} end={link.end} onClick={close} style={({ isActive }) => navLinkStyle(isActive)}>
											<Icon size={17} />
											{link.label}
										</NavLink>
									);
								})}
							</NavGroup>
						);
					})}
				</>
			)}
		</>
	);
});

/**
 * AdminSidebar — 管理员侧边导航栏
 *
 * 固定左侧 240px 宽，包含用户信息、导航分组、工具按钮。
 * 移动端通过 mobileOpen 控制滑入/滑出。
 */
export default function AdminSidebar({
	userLinks,
	adminLinks,
	mobileOpen,
	onClose,
	onLogout,
	onAbout,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	mobileOpen: boolean;
	onClose: () => void;
	onLogout: () => void;
	onAbout: () => void;
}) {
	const user = useAuthStore((s) => s.user);
	const avatar = getUserAvatar(user?.gender);
	const { openFeedback } = useFeedback();
	const isMobile = useIsMobile();

	return (
		<Box
			component="aside"
			aria-label="主导航"
			style={{
				position: "fixed",
				top: 0,
				bottom: 0,
				left: 0,
				zIndex: 50,
				display: "flex",
				flexDirection: "column",
				width: 240,
				borderRight: "1px solid var(--mantine-color-gray-3)",
				background: "var(--mantine-color-body)",
				transform: !isMobile || mobileOpen ? "translateX(0)" : "translateX(-100%)",
				transition: "transform 300ms ease-out",
			}}
		>
			<Group h={56} gap={10} px="md" wrap="nowrap">
				<Box
					style={{
						width: 32,
						height: 32,
						borderRadius: "var(--mantine-radius-md)",
						background: "var(--mantine-color-teal-6)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<IconStethoscope size={16} style={{ color: "white" }} />
				</Box>
				<Box style={{ minWidth: 0 }}>
					<Text size="sm" fw={600} truncate>
						虚拟患者系统
					</Text>
					<Button variant="transparent" size="xs" p={0} onClick={onAbout}>
						{APP_VERSION}
					</Button>
				</Box>
			</Group>

			<Box component="nav" style={{ flex: 1, overflowY: "auto" }} px={8} py={8}>
				<SidebarNav userLinks={userLinks} adminLinks={adminLinks} close={onClose} />
			</Box>

			<Separator />
			<Box p="sm">
				<NavLink to="/profile" onClick={onClose} style={({ isActive }) => ({
					display: "flex",
					alignItems: "center",
					gap: 10,
					borderRadius: "var(--mantine-radius-md)",
					padding: "10px 12px",
					marginBottom: 8,
					textDecoration: "none",
					background: isActive ? "var(--mantine-color-teal-light)" : "var(--mantine-color-gray-1)",
				})}>
					<img
						src={avatar}
						alt={user?.display_name ? `${user.display_name} 的头像` : "用户头像"}
						style={{ width: 32, height: 32, flexShrink: 0, borderRadius: "50%", objectFit: "cover", background: "var(--mantine-color-gray-1)" }}
					/>
					<Box style={{ minWidth: 0, flex: 1 }}>
						<Text size="sm" fw={500} truncate>
							{user?.display_name}
						</Text>
						<Text size="xs" c="dimmed">
							{user?.role_display_name || user?.role || "用户"}
						</Text>
					</Box>
				</NavLink>
				<Group justify="space-between" gap={4} wrap="nowrap">
					<ModeToggle />
					<NotificationBell />
					<Group gap={4}>
						<Button variant="subtle" color="gray" size="sm" w={36} h={36} p={0} onClick={openFeedback} aria-label="意见反馈">
							<IconMessageCirclePlus size={13} />
						</Button>
						<Button variant="subtle" color="gray" size="sm" w={36} h={36} p={0} onClick={onLogout} aria-label="退出登录">
							<IconLogout size={13} />
						</Button>
					</Group>
				</Group>
			</Box>
		</Box>
	);
}
