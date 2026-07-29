import { Bot, ClipboardList, Stethoscope, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortViewport } from "@/hooks/useShortViewport";
import { cn } from "@/lib/utils";

/**
 * 判断当前路径是否属于某个 Tab 的活动范围。
 * 例如 "记录" Tab 覆盖 /history, /record/:id, /my-feedback。
 */
function isTabActive(pathname: string, root: string, subPrefixes: string[]): boolean {
	if (pathname === root || pathname.startsWith(`${root}/`)) return true;
	return subPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const BOTTOM_TABS: Array<{
	to: string;
	icon: typeof Stethoscope;
	label: string;
	activeOn: string[];
}> = [
	{
		to: "/training",
		icon: Stethoscope,
		label: "训练",
		activeOn: ["/training"],
	},
	{
		to: "/history",
		icon: ClipboardList,
		label: "记录",
		activeOn: ["/record", "/my-feedback"],
	},
	{
		to: "/qa",
		icon: Bot,
		label: "问答",
		activeOn: ["/qa"],
	},
	{
		to: "/profile",
		icon: User,
		label: "我的",
		activeOn: ["/notifications"],
	},
];

/**
 * BottomTabBar — 移动端底部 4 Tab 导航栏
 * 训练 | 记录 | 问答 | 我的
 * 仅在 md 断点以下显示（md:hidden）。短视口压缩为仅图标。
 */
export function BottomTabBar() {
	const location = useLocation();
	const navigate = useNavigate();
	const isShort = useShortViewport();

	return (
		<nav
			className={cn(
				"flex items-center justify-around border-t border-border bg-card shrink-0 md:hidden",
				isShort ? "h-10" : "",
			)}
			style={{
				paddingBottom: isShort ? "0" : "env(safe-area-inset-bottom, 0px)",
				height: isShort ? "40px" : `calc(56px + env(safe-area-inset-bottom, 0px))`,
			}}
		>
			{BOTTOM_TABS.map((tab) => {
				const Icon = tab.icon;
				const isActive = isTabActive(location.pathname, tab.to, tab.activeOn);
				return (
					<button
						key={tab.to}
						type="button"
						onClick={() => navigate(tab.to)}
						className="relative flex flex-1 flex-col items-center justify-center h-full transition-all active:scale-95"
					>
						{isActive && (
							<span className="absolute top-0 left-1/4 right-1/4 h-0.5 rounded-b-full bg-primary" />
						)}
						<Icon
							size={isShort ? 20 : 22}
							strokeWidth={isActive ? 2.5 : 2}
							className={cn(
								"transition-all duration-200",
								isActive ? "text-primary" : "text-muted-foreground",
							)}
						/>
						{!isShort && (
							<span
								className={cn(
									"text-[10px] font-semibold leading-tight transition-colors",
									isActive ? "text-primary" : "text-muted-foreground",
								)}
							>
								{tab.label}
							</span>
						)}
					</button>
				);
			})}
		</nav>
	);
}
