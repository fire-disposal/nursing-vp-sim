import { Box, Group, Text } from "@mantine/core";
import { IconMenu2 } from "@tabler/icons-react";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import AdminSidebar from "./AdminSidebar";
import { BottomTabBar } from "./BottomTabBar";
import ShellTransition from "./ShellTransition";
import { StudentTopNav } from "./StudentTopNav";
import type { NavItem } from "./navigation";
import { NAV_ITEMS } from "./navigation";
import { NetworkBanner } from "@/components/NetworkBanner";
import Button from "@/components/ui/button";
import LoadingState from "@/components/ui/loading-state";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import useAuthStore from "@/stores/authStore";
import { isAdminPermissions } from "@/utils/permissions";

/**
 * TabBarLayout — 学生端 Tab 导航布局
 */
function TabBarLayout({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
	const permissions = useAuthStore((s) => s.permissions);
	const permKey = permissions.join(",");
	const isOnline = useNetworkStatus();

	const links = useMemo(
		() =>
			NAV_ITEMS.filter(
				(l) => !l.permission || permissions.includes(l.permission),
			),
		[permKey],
	);

	return (
		<Box style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden" }}>
			{!isOnline && <NetworkBanner />}
			<StudentTopNav links={links} onLogout={onLogout} />
			<Box style={{ flex: 1, overflowY: "auto" }} p={{ base: "sm", sm: "lg", lg: "xl" }}>
				<ShellTransition>{children}</ShellTransition>
			</Box>
			<BottomTabBar />
		</Box>
	);
}

/**
 * AdminLayout — 管理员侧边栏布局
 */
function AdminLayout({
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
	const [mobileOpen, setMobileOpen] = useState(false);
	const isOnline = useNetworkStatus();
	const isShort = useShortViewport();

	return (
		<Box style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
			{mobileOpen && (
				<Box
					hiddenFrom="sm"
					onClick={() => setMobileOpen(false)}
					role="presentation"
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 40,
						background: "rgba(0, 0, 0, 0.4)",
					}}
				/>
			)}

			<AdminSidebar
				userLinks={userLinks}
				adminLinks={adminLinks}
				mobileOpen={mobileOpen}
				onClose={() => setMobileOpen(false)}
				onLogout={onLogout}
				onAbout={onAbout}
			/>

			<Box
				style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden" }}
				ml={{ base: 0, sm: 240 }}
			>
				{!isOnline && <NetworkBanner />}

				{/* Mobile top bar */}
				<Group
					gap="sm"
					px="md"
					hiddenFrom="sm"
					h={isShort ? 40 : 56}
					wrap="nowrap"
					style={{
						flexShrink: 0,
						borderBottom: "1px solid var(--mantine-color-gray-3)",
						background: "var(--mantine-color-body)",
					}}
				>
					<Button
						variant="outline"
						size="icon-sm"
						onClick={() => setMobileOpen((v) => !v)}
						aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
					>
						<IconMenu2 size={18} />
					</Button>
					<Box style={{ flex: 1, minWidth: 0 }}>
						<Text size="sm" fw={600}>
							虚拟患者系统
						</Text>
					</Box>
				</Group>

				<Box
					style={{ flex: 1, overflowY: "auto" }}
					p={isShort ? 8 : { base: 16, sm: 24, lg: 32 }}
				>
					<ShellTransition>{children}</ShellTransition>
				</Box>
			</Box>
		</Box>
	);
}

/**
 * ManageShell — 管理浏览壳
 *
 * 根据角色分叉：
 * - 学生：顶部导航 + 内容 + 底部 Tab
 * - 管理员：侧边栏 + 内容
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
	const hasAdminPerm = useMemo(() => isAdminPermissions(permissions), [permissions]);

	const content = children || (
		<Suspense fallback={<LoadingState />}>
			<Outlet />
		</Suspense>
	);

	if (hasAdminPerm) {
		return (
			<AdminLayout
				userLinks={userLinks}
				adminLinks={adminLinks}
				onLogout={onLogout}
				onAbout={onAbout}
			>
				{content}
			</AdminLayout>
		);
	}

	return <TabBarLayout onLogout={onLogout}>{content}</TabBarLayout>;
}
