import {
	Activity, BarChart3, ClipboardCheck, ClipboardList, Coins,
	GraduationCap, HelpCircle, Home, Info, LogOut, Megaphone,
	Menu, MessageSquare, Server, Settings, Shield, Stethoscope,
	UserSearch, Users, X,
} from "lucide-react";
import { memo, type ReactNode, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
import NotificationBell from "@/components/NotificationBell";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { Separator } from "@/components/ui/separator";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";
import { cn } from "@/utils/cn";
import { APP_VERSION } from "@/version";

interface NavLinkItem {
	to: string;
	icon: typeof Home;
	label: string;
	permission?: string;
}

const allLinks: NavLinkItem[] = [
	{ to: "/home", icon: Home, label: "首页" },
	{ to: "/training", icon: Stethoscope, label: "病例训练", permission: "training_access" },
	{ to: "/history", icon: ClipboardList, label: "训练记录" },
	{ to: "/qa", icon: HelpCircle, label: "护理问答", permission: "qa_access" },
	{ to: "/stats", icon: BarChart3, label: "训练统计", permission: "stats_view" },
	{ to: "/my-responses", icon: ClipboardCheck, label: "我的问卷" },
	{ to: "/admin/users", icon: Users, label: "用户管理", permission: "user_manage" },
	{ to: "/admin/roles", icon: Shield, label: "角色管理", permission: "role_manage" },
	{ to: "/admin/grades-classes", icon: GraduationCap, label: "班级管理", permission: "grade_class_manage" },
	{ to: "/admin/cases", icon: UserSearch, label: "病例管理", permission: "case_manage" },
	{ to: "/admin/practices", icon: ClipboardList, label: "练习模板", permission: "case_manage" },
	{ to: "/admin/assignments", icon: ClipboardCheck, label: "练习发布", permission: "assignment_manage" },
	{ to: "/admin", icon: Settings, label: "训练管理", permission: "score_review" },
	{ to: "/admin/llm", icon: Server, label: "LLM 管理", permission: "llm_monitor" },
	{ to: "/admin/costs", icon: Coins, label: "成本管理", permission: "llm_monitor" },
	{ to: "/admin/feedback", icon: MessageSquare, label: "用户反馈", permission: "feedback_review" },
	{ to: "/admin/questionnaires", icon: ClipboardCheck, label: "问卷管理", permission: "questionnaire_manage" },
	{ to: "/admin/system-ops", icon: Activity, label: "系统运维", permission: "api_manage" },
	{ to: "/admin/system-notifications", icon: Megaphone, label: "系统通知", permission: "api_manage" },
];

const STUDENT_LINKS: NavLinkItem[] = [
	{ to: "/home", icon: Home, label: "首页" },
	{ to: "/training", icon: Stethoscope, label: "训练" },
	{ to: "/history", icon: ClipboardList, label: "记录" },
	{ to: "/stats", icon: BarChart3, label: "统计", permission: "stats_view" },
	{ to: "/qa", icon: HelpCircle, label: "问答", permission: "qa_access" },
];

// ── Student top navigation ──
function StudentTopNav({ links, onLogout }: { links: NavLinkItem[]; onLogout: () => void }) {
	const [mobileOpen, setMobileOpen] = useState(false);

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

				{/* Nav links */}
				<nav className="hidden md:flex items-center gap-0.5 flex-1">
					{links.map((link) => {
						const Icon = link.icon;
						return (
							<NavLink
								key={link.to}
								to={link.to}
								end={link.to === "/home"}
								className={({ isActive }) =>
									cn(
										"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
										isActive && "bg-primary/10 text-primary",
									)
								}
							>
								<Icon size={16} />
								{link.label}
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

			{/* Mobile nav */}
			{mobileOpen && (
				<nav className="md:hidden border-t border-border px-3 py-2 space-y-0.5">
					{links.map((link) => {
						const Icon = link.icon;
						return (
							<NavLink
								key={link.to}
								to={link.to}
								end={link.to === "/home"}
								onClick={() => setMobileOpen(false)}
								className={({ isActive }) =>
									cn(
										"flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent",
										isActive && "bg-primary/10 text-primary",
									)
								}
							>
								<Icon size={17} />
								{link.label}
							</NavLink>
						);
					})}
				</nav>
			)}
		</header>
	);
}

// ── Admin sidebar ──
function AdminSidebar({
	userLinks, adminLinks, mobileOpen, onClose, onLogout, onAbout,
}: {
	userLinks: NavLinkItem[]; adminLinks: NavLinkItem[];
	mobileOpen: boolean; onClose: () => void; onLogout: () => void; onAbout: () => void;
}) {
	const user = useAuthStore((s) => s.user);
	const avatar = getUserAvatar(user?.gender);

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
					<div className="text-xs text-muted-foreground">护理训练平台</div>
				</div>
			</div>

			<nav className="flex-1 overflow-y-auto px-2 py-2">
				<SidebarNav userLinks={userLinks} adminLinks={adminLinks} close={onClose} />
			</nav>

			<Separator />
			<div className="p-3">
				<NavLink to="/profile" onClick={onClose}
					className={({ isActive }) =>
						cn("mb-3 flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent",
							isActive ? "bg-primary/10" : "bg-muted/50")
					}
				>
					<img src={avatar} alt="" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border bg-muted" />
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium">{user?.display_name}</div>
						<div className="text-xs text-muted-foreground">{user?.role_display_name || user?.role || "用户"}</div>
					</div>
				</NavLink>
				<div className="flex gap-1 flex-wrap items-center">
					<ModeToggle />
					<NotificationBell />
					<Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onAbout}><Info size={13} />关于</Button>
					<Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={onLogout}>
						<LogOut size={13} />退出
					</Button>
				</div>
			</div>
		</aside>
	);
}

// ── Main Layout ──
export default function Layout({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const location = useLocation();
	const permissions = useAuthStore((s) => s.permissions);
	const logout = useAuthStore((s) => s.logout);
	const permKey = permissions.join(",");
	const [mobileOpen, setMobileOpen] = useState(false);
	const [aboutOpen, setAboutOpen] = useState(false);
	const { openFeedback } = useFeedback();
	const isOnline = useNetworkStatus();

	const hasAdminPerm = permissions.some(
		(p) => p !== "training_access" && p !== "qa_access" && p !== "stats_view",
	);

	const links = useMemo(() => {
		return allLinks.filter((l) => !l.permission || permissions.includes(l.permission));
	}, [permKey]);

	const userLinks = links.filter((l) => !l.to.startsWith("/admin"));
	const adminLinks = links.filter((l) => l.to.startsWith("/admin"));

	const isTrainingPage = location.pathname.startsWith("/training/");
	const isQAPage = location.pathname.startsWith("/qa");

	const handleLogout = () => { logout(); navigate("/login"); };

	// Student layout: top nav
	if (!hasAdminPerm) {
		return (
			<div className="flex flex-col h-screen overflow-hidden">
				{!isOnline && <NetworkBanner />}
				{isTrainingPage ? children : (
					<>
						<StudentTopNav links={STUDENT_LINKS} onLogout={handleLogout} />
						{isQAPage ? (
							<div className="flex-1 min-h-0 overflow-hidden">{children}</div>
						) : (
							<main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
						)}
					</>
				)}
			</div>
		);
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
				<div className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden shrink-0">
					<button type="button" className="flex size-9 items-center justify-center rounded-lg border border-border hover:bg-accent"
						onClick={() => setMobileOpen((v) => !v)} aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}>
						{mobileOpen ? <X size={18} /> : <Menu size={18} />}
					</button>
					<div className="flex-1 min-w-0"><span className="text-sm font-semibold">虚拟患者系统</span></div>
				</div>
				{isTrainingPage ? children : isQAPage ? (
					<div className="flex-1 min-h-0 overflow-hidden">{children}</div>
				) : (
					<div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</div>
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
	userLinks: NavLinkItem[]; adminLinks: NavLinkItem[]; close: () => void;
}) {
	return (
		<>
			{userLinks.map((link) => {
				const Icon = link.icon;
				return (
					<NavLink key={link.to} to={link.to} end={link.to === "/home"} onClick={close}
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
					<div className="px-3 py-1">
						<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">管理</p>
					</div>
					{adminLinks.map((link) => {
						const Icon = link.icon;
						return (
							<NavLink key={link.to} to={link.to} end={link.to === "/admin"} onClick={close}
								className={({ isActive }) =>
									cn("mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
										isActive && "bg-primary/10 text-primary")
								}
							>
								<Icon size={17} />{link.label}
							</NavLink>
						);
					})}
				</>
			)}
		</>
	);
});
