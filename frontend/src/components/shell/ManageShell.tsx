import { ActionIcon, AppShell, Box, Burger, Button, Group, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLogout, IconMessageCirclePlus, IconStethoscope } from "@tabler/icons-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { APP_VERSION } from "@/version";
import { useFeedback } from "@/components/FeedbackProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
import NotificationBell from "@/components/NotificationBell";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useUiPrefsStore } from "@/stores/uiPrefsStore";
import useAuthStore from "@/stores/authStore";
import { isAdminPermissions } from "@/utils/permissions";
import SidebarNav from "./SidebarNav";
import { BottomTabBar } from "./BottomTabBar";
import ShellTransition from "./ShellTransition";
import type { NavItem } from "./navigation";

/**
 * ManageShell — 统一 Mantine AppShell 布局
 *
 * 桌面端：学生/管理统一使用左侧栏（NavLink 分组，可折叠）。
 * 移动端：学生用底部 Tab，管理用 Drawer（Burger）。
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
	const { openFeedback } = useFeedback();
	// 横屏/短视口（高度 <500px）：垂直空间宝贵 → 压缩顶栏、折叠侧栏、保留底部 Tab
	const isShort = useShortViewport();
	const sidebarCollapsed = useUiPrefsStore((s) => s.sidebarCollapsed);
	const setSidebarCollapsed = useUiPrefsStore((s) => s.setSidebarCollapsed);
	const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
	const [desktopOpened, { toggle: toggleDesktop, close: closeDesktop }] = useDisclosure(!sidebarCollapsed);
	// 短视口强制折叠（横屏手机默认）
	useEffect(() => {
		if (isShort) closeDesktop();
	}, [isShort, closeDesktop]);
	// 折叠状态持久化：刷新/重进后保留用户的侧栏偏好
	useEffect(() => {
		setSidebarCollapsed(!desktopOpened);
	}, [desktopOpened, setSidebarCollapsed]);

	// 路由切换时主内容滚动回顶（避免停留在旧页面滚动位置）
	const mainRef = useRef<HTMLDivElement>(null);
	const { pathname } = useLocation();
	useEffect(() => {
		mainRef.current?.scrollTo({ top: 0 });
	}, [pathname]);

	return (
		<AppShell
			header={{ height: { base: 56, sm: isShort ? 48 : 56 } }}
			navbar={{
				width: 260,
				breakpoint: "sm",
				collapsed: { mobile: !mobileOpened, desktop: !desktopOpened },
			}}
			footer={!isAdmin
				? { height: { base: "calc(56px + env(safe-area-inset-bottom, 0px))", sm: isShort ? "calc(56px + env(safe-area-inset-bottom, 0px))" : 0 } }
				: undefined}
			padding={0}
		>
			<AppShell.Header>
				<Group h="100%" px="md" gap="sm" wrap="nowrap">
					{isAdmin && (
						<Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="切换菜单" />
					)}
					<Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="sm" aria-label="折叠侧边栏" />

					<Group gap={8} wrap="nowrap">
						<Box
							component={Link}
							to="/home"
							w={30}
							h={30}
							title="返回首页"
							aria-label="返回首页"
							style={{
								borderRadius: "var(--mantine-radius-md)",
								background:
									"linear-gradient(135deg, var(--mantine-color-brand-6) 0%, var(--mantine-color-brand-8) 100%)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								boxShadow: "var(--mantine-shadow-sm)",
								flexShrink: 0,
								cursor: "pointer",
							}}
						>
							<IconStethoscope size={17} style={{ color: "white" }} />
						</Box>
						<Text fw={700} size="sm" visibleFrom="xs">
							虚拟患者系统
						</Text>
						<UnstyledButton
							onClick={onAbout}
							title="关于系统"
							aria-label="关于系统"
							visibleFrom="sm"
							style={{
								fontSize: 11,
								color: "var(--mantine-color-dimmed)",
								fontVariantNumeric: "tabular-nums",
								padding: "2px 6px",
								borderRadius: "var(--mantine-radius-sm)",
								transition: "color 120ms ease, background 120ms ease",
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.color = "var(--mantine-color-brand-7)";
								e.currentTarget.style.background = "var(--mantine-color-brand-0)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.color = "var(--mantine-color-dimmed)";
								e.currentTarget.style.background = "transparent";
							}}
						>
							v{APP_VERSION}
						</UnstyledButton>
					</Group>

					<Group gap={4} ml="auto" wrap="nowrap">
						<ModeToggle />
						<NotificationBell />
						<Button variant="default" size="sm" onClick={openFeedback} leftSection={<IconMessageCirclePlus size={16} />} visibleFrom="sm">
							反馈
						</Button>
						<Tooltip label="退出登录">
							<ActionIcon
								variant="default"
								size={36}
								onClick={onLogout}
								aria-label="退出登录"
								title="退出登录"
							>
								<IconLogout size={16} />
							</ActionIcon>
						</Tooltip>
					</Group>
				</Group>
			</AppShell.Header>

			<AppShell.Navbar p="sm">
				<SidebarNav
					userLinks={userLinks}
					adminLinks={adminLinks}
					onNavigate={() => mobileOpened && toggleMobile()}
				/>
			</AppShell.Navbar>

			<AppShell.Main ref={mainRef}>
				{!isOnline && <NetworkBanner />}
				{/* 内容容器：超宽屏不贴边，管理页可读性（表格仍可横向滚动） */}
				<Box p={{ base: "sm", sm: "lg" }} maw={1600} mx="auto" style={{ width: "100%" }}>
					<ShellTransition>{children}</ShellTransition>
				</Box>
			</AppShell.Main>

			{!isAdmin && (
				<AppShell.Footer>
					<BottomTabBar />
				</AppShell.Footer>
			)}
		</AppShell>
	);
}
