/**
 * StudentTabShell — 底部 Tab 导航壳
 *
 * 用于学生端主要导航页：
 *   /home        — 首页
 *   /training    — 病例训练
 *   /history     — 训练记录
 *   /my-responses — 我的问卷
 *   /qa          — 护理问答
 *
 * 渲染结构：
 *   ┌──────────────────────┐
 *   │   StudentTopNav      │  ← 顶部导航栏
 *   ├──────────────────────┤
 *   │   flex-1 内容区      │
 *   │   (Outlet)           │
 *   ├──────────────────────┤
 *   │   BottomTabBar       │  ← 底部 Tab（移动端可见）
 *   └──────────────────────┘
 */
import {
	ClipboardCheck,
	ClipboardList,
	HelpCircle,
	Home,
	LogOut,
	Menu,
	MessageSquarePlus,
	Stethoscope,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, Suspense, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
import NotificationBell from "@/components/NotificationBell";
import { ModeToggle } from "@/components/ui/mode-toggle";
import type { NavItem } from "@/config/navigation";
import { NAV_ITEMS } from "@/config/navigation";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import useAuthStore from "@/stores/authStore";
import { cn } from "@/utils/cn";
import LoadingState from "@/components/ui/loading-state";

// ── Tab 定义 ──
const BOTTOM_TABS: Array<{
	to: string;
	icon: typeof Home;
	label: string;
	shortLabel: string;
	end?: boolean;
}> = [
	{ to: "/home", icon: Home, label: "首页", shortLabel: "首页", end: true },
	{ to: "/training", icon: Stethoscope, label: "病例训练", shortLabel: "训练" },
	{ to: "/history", icon: ClipboardList, label: "训练记录", shortLabel: "记录" },
	{ to: "/my-responses", icon: ClipboardCheck, label: "我的问卷", shortLabel: "问卷" },
	{ to: "/qa", icon: HelpCircle, label: "护理问答", shortLabel: "问答" },
];

// ── Bottom Tab Bar ──
function BottomTabBar() {
	const location = useLocation();
	const navigate = useNavigate();

	return (
		<nav
			className="flex items-center justify-around border-t border-border bg-card shrink-0 md:hidden"
			style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", height: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
		>
			{BOTTOM_TABS.map((tab) => {
				const Icon = tab.icon;
				const isActive = tab.end
					? location.pathname === tab.to
					: location.pathname.startsWith(tab.to);
				return (
					<button
						key={tab.to}
						type="button"
						onClick={() => navigate(tab.to)}
						className="flex flex-1 flex-col items-center justify-center gap-0.5 h-full transition-colors"
					>
						<Icon
							size={20}
							className={cn(
								"transition-colors",
								isActive ? "text-primary" : "text-muted-foreground",
							)}
						/>
						<span
							className={cn(
								"text-[10px] font-medium leading-tight transition-colors",
								isActive
									? "text-primary"
									: "text-muted-foreground",
							)}
						>
							{tab.shortLabel}
						</span>
					</button>
				);
			})}
		</nav>
	);
}

// ── Student top navigation (从 Layout.tsx 抽取) ──
function StudentTopNav({
	links,
	onLogout,
}: {
	links: NavItem[];
	onLogout: () => void;
}) {
	const [mobileOpen, setMobileOpen] = useState(false);
	const { openFeedback } = useFeedback();

	return (
		<header className="shrink-0 border-b border-border bg-card">
			<div className="flex h-14 items-center gap-2 px-4">
				{/* Brand */}
				<div className="flex items-center gap-2.5 mr-4">
					<div className="flex size-8 items-center justify-center rounded-lg bg-primary">
						<Stethoscope size={16} className="text-primary-foreground" />
					</div>
					<span className="text-sm font-semibold hidden sm:block">虚拟患者系统</span>
				</div>

				{/* Nav links (desktop) */}
				<nav className="hidden md:flex items-center gap-0.5 flex-1">
					{links.map((link) => {
						const Icon = link.icon;
						return (
							<NavLink
								key={link.to}
								to={link.to}
								end={link.end}
								className={({ isActive }) =>
									cn(
										"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
										isActive && "bg-primary/10 text-primary",
									)
								}
							>
								<Icon size={16} />
								{link.shortLabel ?? link.label}
							</NavLink>
						);
					})}
				</nav>

				{/* Mobile menu button */}
				<button
					type="button"
					className="flex md:hidden size-9 items-center justify-center rounded-lg border border-border hover:bg-accent mr-auto"
					onClick={() => setMobileOpen((v) => !v)}
					aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
				>
					{mobileOpen ? <X size={18} /> : <Menu size={18} />}
				</button>

				{/* Right side */}
				<div className="flex items-center gap-1">
					<button
						onClick={openFeedback}
						className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
						title="意见反馈"
						aria-label="意见反馈"
					>
						<MessageSquarePlus size={16} />
					</button>
					<NotificationBell />
					<ModeToggle />
					<button
						onClick={onLogout}
						className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
						title="退出登录"
					>
						<LogOut size={15} />
					</button>
				</div>
			</div>

			{/* Mobile nav (overlay) */}
			{mobileOpen && (
				<nav className="md:hidden border-t border-border px-3 py-2 space-y-0.5">
					{links.map((link) => {
						const Icon = link.icon;
						return (
							<NavLink
								key={link.to}
								to={link.to}
								end={link.end}
								onClick={() => setMobileOpen(false)}
								className={({ isActive }) =>
									cn(
										"flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent",
										isActive && "bg-primary/10 text-primary",
									)
								}
							>
								<Icon size={17} />
								{link.shortLabel ?? link.label}
							</NavLink>
						);
					})}
				</nav>
			)}
		</header>
	);
}

// ── Component ──
export default function StudentTabShell({ children }: { children?: ReactNode }) {
	const navigate = useNavigate();
	const permissions = useAuthStore((s) => s.permissions);
	const logout = useAuthStore((s) => s.logout);
	const permKey = permissions.join(",");
	const isOnline = useNetworkStatus();

	const links = useMemo(
		() =>
			NAV_ITEMS.filter(
				(l) => !l.permission || permissions.includes(l.permission),
			),
		[permKey],
	);

	const handleLogout = () => {
		logout();
		navigate("/login");
	};

	const content = children || (
		<Suspense fallback={<LoadingState className="h-full" />}>
			<Outlet />
		</Suspense>
	);

	return (
		<div className="flex flex-col h-screen overflow-hidden">
			{!isOnline && <NetworkBanner />}
			<StudentTopNav links={links} onLogout={handleLogout} />
			<div className="flex-1 min-h-0 overflow-hidden">
				{content}
			</div>
			<BottomTabBar />
		</div>
	);
}
