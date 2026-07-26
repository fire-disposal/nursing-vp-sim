import { Suspense, useMemo, useState, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import AdminSidebar from "./AdminSidebar";
import { BottomTabBar } from "./BottomTabBar";
import BreadcrumbBar from "./BreadcrumbBar";
import ShellTransition from "./ShellTransition";
import { StudentTopNav } from "./StudentTopNav";
import type { NavItem } from "./navigation";
import { NAV_ITEMS } from "./navigation";
import { NetworkBanner } from "@/components/NetworkBanner";
import LoadingState from "@/components/ui/loading-state";
import { useShortViewport } from "@/hooks/useShortViewport";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import useAuthStore from "@/stores/authStore";
import { cn } from "@/utils/cn";
import { isAdminPermissions } from "@/utils/permissions";

/**
 * TabBarLayout — 学生端 Tab 导航布局
 */
function TabBarLayout({ children }: { children: ReactNode }) {
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
		<div className="flex flex-col h-screen overflow-hidden" style={{ height: "100dvh" }}>
			{!isOnline && <NetworkBanner />}
			<StudentTopNav links={links} />
			<div className="flex-1 overflow-y-auto p-3 sm:p-6 lg:p-8">
				<ShellTransition>{children}</ShellTransition>
			</div>
			<BottomTabBar />
		</div>
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
		<div className="flex h-screen overflow-hidden" style={{ height: "100dvh" }}>
			{mobileOpen && (
				<div
					className="fixed inset-0 z-40 bg-black/40 md:hidden"
					onClick={() => setMobileOpen(false)}
					role="presentation"
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

			<div
				className="flex flex-1 flex-col md:ml-60 overflow-hidden"
				style={{ paddingTop: "max(env(safe-area-inset-top), 0px)" }}
			>
				{!isOnline && <NetworkBanner />}

				{/* Mobile top bar */}
				<div className={cn("flex items-center gap-3 border-b border-border bg-card px-4 md:hidden shrink-0", isShort ? "h-10" : "h-14")}>
					<button
						type="button"
						className="flex size-9 items-center justify-center rounded-lg border border-border hover:bg-accent"
						onClick={() => setMobileOpen((v) => !v)}
						aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" role="img" aria-hidden="true"><title>菜单</title><path d="M3 12h18M3 6h18M3 18h18" /></svg>
					</button>
					<div className="flex-1 min-w-0">
						<span className="text-sm font-semibold">虚拟患者系统</span>
					</div>
				</div>

				<BreadcrumbBar className="px-4 py-1.5 border-b border-border bg-card/50 shrink-0 hidden md:block" />

				<div className={cn("flex-1 overflow-y-auto", isShort ? "p-2" : "p-4 sm:p-6 lg:p-8")}>
					<ShellTransition>{children}</ShellTransition>
				</div>
			</div>
		</div>
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
		<Suspense fallback={<LoadingState className="h-full" />}>
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

	return <TabBarLayout>{content}</TabBarLayout>;
}
