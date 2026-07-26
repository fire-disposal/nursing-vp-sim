import { LogOut, MessageSquarePlus, Stethoscope } from "lucide-react";
import { memo, useMemo } from "react";
import { NavLink } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import Button from "@/components/ui/button";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { NavGroup } from "@/components/ui/nav-group";
import { Separator } from "@/components/ui/separator";
import NotificationBell from "@/components/NotificationBell";
import type { NavGroupKey, NavItem } from "./navigation";
import { NAV_GROUPS } from "./navigation";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";
import { cn } from "@/utils/cn";
import { APP_VERSION } from "@/version";

const SidebarNav = memo(function SidebarNav({
	userLinks, adminLinks, close,
}: {
	userLinks: NavItem[]; adminLinks: NavItem[]; close: () => void;
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
			{ungrouped.length > 0 && (
				<>
					<Separator className="my-2" />
					{ungrouped.map((link) => {
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
				</>
			)}
			{grouped.size > 0 && (
				<>
					<Separator className="my-2" />
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
