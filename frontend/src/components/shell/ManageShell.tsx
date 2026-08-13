import {
	AppShell,
	Box,
	Burger,
	Button,
	Group,
	Text,
	ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	IconMessageCirclePlus,
	IconStethoscope,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
import NotificationBell from "@/components/NotificationBell";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import useAuthStore from "@/stores/authStore";
import { isAdminPermissions } from "@/utils/permissions";
import AdminSidebarNav from "./AdminSidebar";
import { BottomTabBar } from "./BottomTabBar";
import ShellTransition from "./ShellTransition";
import type { NavItem } from "./navigation";

function isLinkActive(pathname: string, link: NavItem): boolean {
	if (link.end) return pathname === link.to;
	return pathname === link.to || pathname.startsWith(`${link.to}/`);
}

/**
 * ManageShell — 统一的 Mantine AppShell 布局
 *
 * 学生端：Header 内水平导航 + 移动端底部 Tab。
 * 管理端：可折叠侧边栏（NavLink 分组）+ 移动端 Drawer。
 */
export default function ManageShell({
	userLinks,
	adminLinks,
	onLogout,
	onAbout,
	children,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	onLogout: () => void;
	onAbout: () => void;
	children: ReactNode;
}) {
	const permissions = useAuthStore((s) => s.permissions);
	const isAdmin = isAdminPermissions(permissions);
	const isOnline = useNetworkStatus();
	const { pathname } = useLocation();
	const { openFeedback } = useFeedback();
	const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
	const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);


	return (
		<AppShell
			header={{ height: 56 }}
			navbar={
				isAdmin
					? {
							width: 260,
							breakpoint: "sm",
							collapsed: { mobile: !mobileOpened, desktop: !desktopOpened },
						}
					: undefined
			}
			padding={0}
		>
			<AppShell.Header>
				<Group h="100%" px="md" gap="sm" wrap="nowrap">
					{isAdmin && (
						<>
							<Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="切换菜单" />
							<Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="sm" aria-label="折叠侧边栏" />
						</>
					)}

					{/* Brand */}
					<Group gap={8} wrap="nowrap" mr={isAdmin ? "xs" : "lg"}>
						<ThemeIcon size={28} radius="sm" variant="filled">
							<IconStethoscope size={16} />
						</ThemeIcon>
						<Text fw={700} size="sm" visibleFrom="xs">
							虚拟患者系统
						</Text>
					</Group>

					{/* Student horizontal nav (desktop) */}
					{!isAdmin && (
						<Group gap={4} visibleFrom="sm" wrap="nowrap">
							{userLinks.map((link) => {
								const active = isLinkActive(pathname, link);
								return (
									<Button
										key={link.to}
										component={Link}
										to={link.to}
										variant={active ? "light" : "subtle"}
										size="sm"
										px="sm"
									>
										{link.label}
									</Button>
								);
							})}
						</Group>
					)}

					{/* Utilities */}
					<Group gap={4} ml="auto" wrap="nowrap">
						<ModeToggle />
						<NotificationBell />
						<Button variant="default" size="sm" onClick={openFeedback} leftSection={<IconMessageCirclePlus size={16} />} visibleFrom="sm">
							反馈
						</Button>
					</Group>
				</Group>
			</AppShell.Header>

			{isAdmin && (
				<AppShell.Navbar p="sm">
					<AdminSidebarNav
						userLinks={userLinks}
						adminLinks={adminLinks}
						onNavigate={() => mobileOpened && toggleMobile()}
						onLogout={onLogout}
						onAbout={onAbout}
					/>
				</AppShell.Navbar>
			)}

			<AppShell.Main>
				{!isOnline && <NetworkBanner />}
				<Box p={{ base: "sm", sm: "lg" }}>
					<ShellTransition>{children}</ShellTransition>
				</Box>
				{!isAdmin && <BottomTabBar />}
			</AppShell.Main>
		</AppShell>
	);
}
