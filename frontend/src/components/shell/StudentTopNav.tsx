import { MessageSquarePlus, Stethoscope } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import NotificationBell from "@/components/NotificationBell";
import type { NavItem } from "./navigation";
import { useShortViewport } from "@/hooks/useShortViewport";
import { cn } from "@/utils/cn";

/** 子页面路径前缀映射 — 确保进入子页面时父级 Tab 保持高亮 */
const TAB_SUB_PATHS: Record<string, string[]> = {
	"/history": ["/record", "/stats", "/my-responses", "/my-feedback"],
	"/profile": ["/notifications", "/qa"],
};

function isLinkActive(pathname: string, link: NavItem): boolean {
	if (link.end) return pathname === link.to;
	if (pathname === link.to || pathname.startsWith(`${link.to}/`)) return true;
	const subs = TAB_SUB_PATHS[link.to];
	if (subs) return subs.some((p) => pathname === p || pathname.startsWith(`${p}/`));
	return false;
}

/**
 * StudentTopNav — 学生端顶部导航栏
 *
 * 桌面端显示水平导航链接（3 项：训练 | 记录 | 我的）。
 * 移动端仅显示品牌 + 通知铃铛 + 反馈入口。
 * 登出和主题切换已移至 Profile 页面。
 */
export function StudentTopNav({ links }: { links: NavItem[] }) {
	const { openFeedback } = useFeedback();
	const { pathname } = useLocation();
	const isShort = useShortViewport();

	return (
		<header className="shrink-0 border-b border-border bg-card">
			<div className={cn("flex items-center gap-2 px-3", isShort ? "h-8" : "h-10 md:h-14")}>
				{/* Brand */}
				<div className="flex items-center gap-2">
					<div className="flex size-7 md:size-8 items-center justify-center rounded-lg bg-primary">
						<Stethoscope size={14} className="md:size-[16px] text-primary-foreground" />
					</div>
					<span className="text-xs md:text-sm font-semibold">虚拟患者系统</span>
				</div>

				{/* Nav links (desktop only) */}
				<nav className="hidden md:flex items-center gap-0.5 flex-1 ml-2">
					{links.map((link) => {
						const Icon = link.icon;
						const active = isLinkActive(pathname, link);
						return (
							<NavLink
								key={link.to}
								to={link.to}
								className={cn(
									"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground",
									active && "bg-primary/10 text-primary",
								)}
							>
								<Icon size={16} />
								{link.shortLabel ?? link.label}
							</NavLink>
						);
					})}
				</nav>

				{/* Right side — utility icons */}
				<div className="flex items-center gap-0.5 ml-auto">
					<button
						onClick={openFeedback}
						className="flex items-center gap-1 h-8 px-2 rounded-lg text-xs text-muted-foreground hover:bg-accent transition-colors"
						title="意见反馈"
						aria-label="意见反馈"
					>
						<MessageSquarePlus size={14} />
						<span className="hidden sm:inline">反馈</span>
					</button>
					<NotificationBell />
				</div>
			</div>
		</header>
	);
}
