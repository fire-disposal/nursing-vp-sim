import { AppShell, Box, Burger, Button, Group, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconMessageCirclePlus, IconStethoscope } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
import NotificationBell from "@/components/NotificationBell";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
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
	const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
	const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);

	return (
		<AppShell
			header={{ height: 56 }}
			navbar={{
				width: 260,
				breakpoint: "sm",
				collapsed: { mobile: !mobileOpened, desktop: !desktopOpened },
			}}
			footer={!isAdmin ? { height: { base: "calc(56px + env(safe-area-inset-bottom, 0px))", sm: 0 } } : undefined}
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
					</Group>

					<Group gap={4} ml="auto" wrap="nowrap">
						<ModeToggle />
						<NotificationBell />
						<Button variant="default" size="sm" onClick={openFeedback} leftSection={<IconMessageCirclePlus size={16} />} visibleFrom="sm">
							反馈
						</Button>
					</Group>
				</Group>
			</AppShell.Header>

			<AppShell.Navbar p="sm">
				<SidebarNav
					userLinks={userLinks}
					adminLinks={adminLinks}
					onNavigate={() => mobileOpened && toggleMobile()}
					onLogout={onLogout}
					onAbout={onAbout}
				/>
			</AppShell.Navbar>

			<AppShell.Main>
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
