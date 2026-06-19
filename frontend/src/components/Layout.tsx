import {
	BarChart3,
	Bug,
	Building2,
	ClipboardCheck,
	ClipboardList,
	GraduationCap,
	HelpCircle,
	Home,
	Info,
	LogOut,
	Megaphone,
	Menu,
	MessageSquare,
	Server,
	Settings,
	Settings2,
	Shield,
	Stethoscope,
	UserSearch,
	Users,
	X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
import NotificationBell from "@/components/NotificationBell";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { ModeToggle } from "@/components/ui/ModeToggle";
import { Separator } from "@/components/ui/separator";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";
import { APP_VERSION } from "@/version";

interface NavLinkItem {
	to: string;
	icon: typeof Home;
	label: string;
	permission?: string;
}

const allLinks: NavLinkItem[] = [
	{ to: "/home", icon: Home, label: "首页" },
	{
		to: "/cases",
		icon: Stethoscope,
		label: "病例训练",
		permission: "training_access",
	},
	{ to: "/history", icon: ClipboardList, label: "训练记录" },
	{ to: "/qa", icon: HelpCircle, label: "护理问答" },
	{ to: "/stats", icon: BarChart3, label: "训练统计" },
	{ to: "/my-responses", icon: ClipboardCheck, label: "我的问卷" },
	{
		to: "/admin/users",
		icon: Users,
		label: "用户管理",
		permission: "user_manage",
	},
	{
		to: "/admin/roles",
		icon: Shield,
		label: "角色管理",
		permission: "role_manage",
	},
	{
		to: "/admin/schools",
		icon: Building2,
		label: "学校管理",
		permission: "school_manage",
	},
	{
		to: "/admin/grades-classes",
		icon: GraduationCap,
		label: "班级管理",
		permission: "grade_class_manage",
	},
	{
		to: "/admin/cases",
		icon: UserSearch,
		label: "病例管理",
		permission: "case_manage",
	},
	{
		to: "/admin/practices",
		icon: ClipboardList,
		label: "练习模板",
		permission: "case_manage",
	},
	{
		to: "/admin/assignments",
		icon: ClipboardCheck,
		label: "练习发布",
		permission: "score_review",
	},
	{
		to: "/admin",
		icon: Settings,
		label: "训练管理",
		permission: "score_review",
	},
	{
		to: "/admin/llm",
		icon: Server,
		label: "LLM 管理",
		permission: "llm_monitor",
	},
	{
		to: "/admin/feedback",
		icon: MessageSquare,
		label: "用户反馈",
		permission: "feedback_review",
	},
	{
		to: "/admin/questionnaires",
		icon: ClipboardCheck,
		label: "问卷管理",
		permission: "questionnaire_manage",
	},
	{
		to: "/admin/debug",
		icon: Bug,
		label: "调试工坊",
		permission: "score_review",
	},
	{
		to: "/admin/system-configs",
		icon: Settings2,
		label: "系统配置",
		permission: "api_manage",
	},
	{
		to: "/admin/system-notifications",
		icon: Megaphone,
		label: "系统通知",
		permission: "api_manage",
	},
];

export default function Layout({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const location = useLocation();
	const user = useAuthStore((s) => s.user);
	const permissions = useAuthStore((s) => s.permissions);
	const logout = useAuthStore((s) => s.logout);
	const links = useMemo(() => {
		return allLinks.filter(
			(link) => !link.permission || permissions.includes(link.permission),
		);
	}, [permissions]);
	const userLinks = links.filter((l) => !l.to.startsWith("/admin"));
	const adminLinks = links.filter((l) => l.to.startsWith("/admin"));
	const [mobileOpen, setMobileOpen] = useState(false);
	const [aboutOpen, setAboutOpen] = useState(false);
	const { openFeedback } = useFeedback();
	const isTrainingPage = location.pathname.startsWith("/training/");
	const isQAPage = location.pathname.startsWith("/qa");
	const isFullPage = isTrainingPage || isQAPage;
	const isOnline = useNetworkStatus();

	const userAvatar = getUserAvatar(user?.gender);

	const close = () => setMobileOpen(false);

	const handleLogout = () => {
		logout();
		navigate("/login");
	};

	return (
		<div className="flex h-screen overflow-hidden">
			{mobileOpen && (
				<div
					className="fixed inset-0 z-40 bg-black/40 md:hidden"
					onClick={close}
					role="presentation"
				/>
			)}

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
					{userLinks.map((link) => {
						const Icon = link.icon;
						return (
							<NavLink
								key={link.to}
								to={link.to}
								end={link.to === "/home"}
								onClick={close}
								className={({ isActive }) =>
									cn(
										"mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
										isActive && "bg-primary/10 text-primary",
									)
								}
							>
								<Icon size={17} />
								{link.label}
							</NavLink>
						);
					})}
					{adminLinks.length > 0 && (
						<>
							<Separator className="my-2" />
							<div className="px-3 py-1">
								<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
									管理
								</p>
							</div>
							{adminLinks.map((link) => {
								const Icon = link.icon;
								return (
									<NavLink
										key={link.to}
										to={link.to}
										end={link.to === "/admin"}
										onClick={close}
										className={({ isActive }) =>
											cn(
												"mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
												isActive && "bg-primary/10 text-primary",
											)
										}
									>
										<Icon size={17} />
										{link.label}
									</NavLink>
								);
							})}
						</>
					)}
				</nav>

				<Separator />

				<div className="p-3">
					<NavLink
						to="/profile"
						onClick={close}
						className={({ isActive }) =>
							cn(
								"mb-3 flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent",
								isActive ? "bg-primary/10" : "bg-muted/50",
							)
						}
					>
						<img
							src={userAvatar}
							alt="头像"
							className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border bg-muted"
						/>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-medium">
								{user?.display_name}
							</div>
							<div className="text-xs text-muted-foreground">
								{user?.role_display_name || user?.role || "用户"}
							</div>
						</div>
					</NavLink>
					<div className="flex gap-1 flex-wrap items-center">
						<ModeToggle />
						<NotificationBell />
						<Button
							variant="ghost"
							size="sm"
							className="h-8 text-xs"
							onClick={() => setAboutOpen(true)}
						>
							<Info size={13} />
							关于
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 text-xs text-destructive hover:text-destructive"
							onClick={handleLogout}
						>
							<LogOut size={13} />
							退出
						</Button>
					</div>
				</div>

				<Modal
					open={aboutOpen}
					onClose={() => setAboutOpen(false)}
					title="关于系统"
				>
					<div className="space-y-3 py-2 text-center">
						<div className="flex justify-center">
							<div className="flex size-12 items-center justify-center rounded-xl bg-primary shadow">
								<Stethoscope size={24} className="text-primary-foreground" />
							</div>
						</div>
						<div>
							<h3 className="text-lg font-semibold">虚拟患者系统</h3>
							<p className="text-sm text-muted-foreground">
								护理病史采集技能训练平台
							</p>
							<p className="mt-2 text-xs text-muted-foreground">
								版本 {APP_VERSION}
							</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							className="w-full"
							onClick={() => {
								setAboutOpen(false);
								openFeedback();
							}}
						>
							<MessageSquare size={14} />
							意见反馈
						</Button>
					</div>
				</Modal>
			</aside>

			<div
				className="flex flex-1 flex-col md:ml-60 overflow-hidden"
				style={{ paddingTop: "max(env(safe-area-inset-top), 0px)" }}
			>
				{!isOnline && <NetworkBanner />}
				<div className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden shrink-0">
					<button
						type="button"
						className="flex size-9 items-center justify-center rounded-lg border border-border hover:bg-accent"
						onClick={() => setMobileOpen((v) => !v)}
						aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
						aria-expanded={mobileOpen}
					>
						{mobileOpen ? <X size={18} /> : <Menu size={18} />}
					</button>
					<div className="flex-1 min-w-0">
						<span className="text-sm font-semibold">虚拟患者系统</span>
					</div>
				</div>
				{isFullPage ? (
					children
				) : (
					<div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
						{children}
					</div>
				)}
			</div>
		</div>
	);
}
