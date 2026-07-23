import {
	LogOut,
	Menu,
	MessageSquare,
	MessageSquarePlus,
	Stethoscope,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, Suspense, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
import NotificationBell from "@/components/NotificationBell";
import { NavGroup } from "@/components/ui/nav-group";
import DefaultShell from "@/components/shell/DefaultShell";
import ImmersiveShell from "@/components/shell/ImmersiveShell";
import StudentTabShell from "@/components/shell/StudentTabShell";
import type { NavGroupKey, NavItem } from "@/components/shell/navigation";
import { NAV_GROUPS, NAV_ITEMS } from "@/components/shell/navigation";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import LoadingState from "@/components/ui/loading-state";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { Separator } from "@/components/ui/separator";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";
import { cn } from "@/utils/cn";
import { isAdminPermissions } from "@/utils/permissions";
import { APP_VERSION } from "@/version";

// ── Admin sidebar ──
function AdminSidebar({
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

	return (
		<aside
			aria-label="主导航"
			className={cn(
				"fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card transition-transform duration-300 ease-out md:translate-x-0",
				mobileOpen ? "translate-x-0" : "-translate-x-full",
			)}
		>
			<div className="flex h-14 items-center gap-2.5 px-4">
				<div className="flex size-8 items-center justify-center rounded-lg bg-primary">
					<Stethoscope size={16} className="text-primary-foreground" />
				</div>
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold">虚拟患者系统</div>
					<button type="button" className="text-xs text-muted-foreground hover:text-foreground cursor-pointer" onClick={onAbout}>{APP_VERSION}</button>
				</div>
			</div>

			<nav className="flex-1 overflow-y-auto px-2 py-2">
				<SidebarNav userLinks={userLinks} adminLinks={adminLinks} close={onClose} />
			</nav>

			<Separator />
			<div className="p-3">
				<NavLink to="/profile" onClick={onClose}
					className={({ isActive }) =>
						cn("mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent",
							isActive ? "bg-primary/10" : "bg-muted/50")
					}
				>
					<img src={avatar} alt={user?.display_name ? `${user.display_name} 的头像` : "用户头像"} className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border bg-muted" />
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium">{user?.display_name}</div>
						<div className="text-xs text-muted-foreground">{user?.role_display_name || user?.role || "用户"}</div>
					</div>
				</NavLink>
				<div className="flex items-center justify-between gap-1">
					<ModeToggle />
					<NotificationBell />
					<div className="flex gap-1">
						<Button variant="ghost" size="sm" className="h-8 text-xs" onClick={openFeedback}>
							<MessageSquarePlus size={13} />
						</Button>
						<Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={onLogout}>
							<LogOut size={13} />
						</Button>
					</div>
				</div>
			</div>
		</aside>
	);
}

const MOBILE_HINT_KEY = "admin:mobileHintDismissed";

// ── Main Layout ──
export default function Layout() {
	const navigate = useNavigate();
	const location = useLocation();
	const permissions = useAuthStore((s) => s.permissions);
	const logout = useAuthStore((s) => s.logout);
	const permKey = permissions.join(",");
	const [mobileOpen, setMobileOpen] = useState(false);
	const [aboutOpen, setAboutOpen] = useState(false);
	const [mobileHintDismissed, setMobileHintDismissed] = useState(
		() => localStorage.getItem(MOBILE_HINT_KEY) === "1",
	);
	const { openFeedback } = useFeedback();
	const isOnline = useNetworkStatus();

	const hasAdminPerm = isAdminPermissions(permissions);

	const { userLinks, adminLinks } = useMemo(() => {
		const filtered = NAV_ITEMS.filter(
			(l) => !l.permission || permissions.includes(l.permission),
		);
		return {
			userLinks: filtered.filter((l) => l.section === "user"),
			adminLinks: filtered.filter((l) => l.section === "admin"),
		};
	}, [permKey]);

	const isTrainingPage = location.pathname.startsWith("/training/");
	const isQAPage = location.pathname.startsWith("/qa");

	const handleLogout = () => {
		logout();
		navigate("/login");
	};

	// Student layout: route-based shell dispatch
	if (!hasAdminPerm) {
		const path = location.pathname;
		const isImmersive = path.startsWith("/training/") && path !== "/training";
		const isSimple =
			path.startsWith("/record/") ||
			path === "/stats" ||
			path === "/my-responses" ||
			path === "/my-feedback";

		if (isImmersive) {
			return <ImmersiveShell><Outlet /></ImmersiveShell>;
		}
		if (isSimple) {
			return <DefaultShell><Outlet /></DefaultShell>;
		}
		return <StudentTabShell><Outlet /></StudentTabShell>;
	}

	// Admin layout: sidebar + content
	return (
		<div className="flex h-screen overflow-hidden">
			{mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} role="presentation" />}

			<AdminSidebar
				userLinks={userLinks} adminLinks={adminLinks}
				mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)}
				onLogout={handleLogout} onAbout={() => setAboutOpen(true)}
			/>

			<div className="flex flex-1 flex-col md:ml-60 overflow-hidden" style={{ paddingTop: "max(env(safe-area-inset-top), 0px)" }}>
				{!isOnline && <NetworkBanner />}
				{!mobileHintDismissed && (
					<div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 md:hidden shrink-0">
						<span className="flex-1">管理后台建议使用桌面端访问以获得完整体验</span>
						<button
							type="button"
							aria-label="关闭提示"
							className="shrink-0 text-amber-700 hover:text-amber-900"
							onClick={() => {
								localStorage.setItem(MOBILE_HINT_KEY, "1");
								setMobileHintDismissed(true);
							}}
						>
							<X size={13} />
						</button>
					</div>
				)}
				<div className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden shrink-0">
					<button type="button" className="flex size-9 items-center justify-center rounded-lg border border-border hover:bg-accent"
						onClick={() => setMobileOpen((v) => !v)} aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}>
						{mobileOpen ? <X size={18} /> : <Menu size={18} />}
					</button>
					<div className="flex-1 min-w-0"><span className="text-sm font-semibold">虚拟患者系统</span></div>
					<NotificationBell />
				</div>
			{isTrainingPage || isQAPage ? (
				<div className="flex-1 min-h-0 overflow-hidden">
					<Suspense fallback={<LoadingState className="h-full" />}>
						<Outlet />
					</Suspense>
				</div>
			) : (
				<div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
					<AnimatePresence mode="wait">
						<motion.div
							key={location.pathname}
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -8 }}
							transition={{ duration: 0.15, ease: "easeOut" }}
						>
							<Suspense fallback={<LoadingState className="h-full" />}>
								<Outlet />
							</Suspense>
						</motion.div>
					</AnimatePresence>
				</div>
			)}
			</div>

			<Dialog open={aboutOpen} onOpenChange={(o) => !o && setAboutOpen(false)}>
				<DialogContent title="关于系统" maxWidth={560}>
					<div className="space-y-3 py-2 text-center">
						<div className="flex justify-center">
							<div className="flex size-12 items-center justify-center rounded-xl bg-primary shadow">
								<Stethoscope size={24} className="text-primary-foreground" />
							</div>
						</div>
						<div>
							<h3 className="text-lg font-semibold">虚拟患者系统</h3>
							<p className="text-sm text-muted-foreground">护理病史采集技能训练平台</p>
							<p className="mt-2 text-xs text-muted-foreground">版本 {APP_VERSION}</p>
						</div>
						<Button variant="outline" size="sm" className="w-full" onClick={() => { setAboutOpen(false); openFeedback(); }}>
							<MessageSquare size={14} />意见反馈
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

const SidebarNav = memo(function SidebarNav({
	userLinks, adminLinks, close,
}: {
	userLinks: NavItem[]; adminLinks: NavItem[]; close: () => void;
}) {
	const adminByGroup = useMemo(() => {
		const map = new Map<NavGroupKey, NavItem[]>();
		for (const link of adminLinks) {
			const group = link.group ?? "teaching";
			if (!map.has(group)) map.set(group, []);
			map.get(group)!.push(link);
		}
		return map;
	}, [adminLinks]);

	return (
		<>
			{userLinks.map((link) => {
				const Icon = link.icon;
				return (
					<NavLink key={link.to} to={link.to} end={link.end} onClick={close}
						className={({ isActive }) =>
							cn("mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
								isActive && "bg-primary/10 text-primary")
						}
					>
						<Icon size={17} />{link.label}
					</NavLink>
				);
			})}
			{adminLinks.length > 0 && (
				<>
					<Separator className="my-2" />
					{NAV_GROUPS.map((group) => {
						const links = adminByGroup.get(group.key);
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
										<NavLink key={link.to} to={link.to} end={link.end} onClick={close}
											className={({ isActive }) =>
												cn("mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
													isActive && "bg-primary/10 text-primary")
											}
										>
											<Icon size={17} />{link.label}
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
