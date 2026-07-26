import { ClipboardList, Stethoscope, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortViewport } from "@/hooks/useShortViewport";
import { cn } from "@/utils/cn";

/**
 * 判断当前路径是否属于某个 Tab 的活动范围。
 * 例如 "记录" Tab 覆盖 /history, /record/:id, /stats, /my-responses, /my-feedback。
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
		activeOn: ["/record", "/stats", "/my-responses", "/my-feedback"],
	},
	{
		to: "/profile",
		icon: User,
		label: "我的",
		activeOn: ["/notifications", "/qa"],
	},
];

/**
 * BottomTabBar — 移动端底部 3 Tab 导航栏
 *
 * 训练 | 记录 | 我的
 * 仅在 md 断点以下显示（md:hidden）。
 */
export function BottomTabBar() {
	const location = useLocation();
	const navigate = useNavigate();
	const isShort = useShortViewport();

	if (isShort) return null;


	return (
		<nav
			className="flex items-center justify-around border-t border-border bg-card/95 backdrop-blur-sm shrink-0 md:hidden"
			style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", height: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
		>
			{BOTTOM_TABS.map((tab) => {
				const Icon = tab.icon;
				const isActive = isTabActive(location.pathname, tab.to, tab.activeOn);
				return (
					<button
						key={tab.to}
						type="button"
						onClick={() => navigate(tab.to)}
						className="relative flex flex-1 flex-col items-center justify-center gap-0.5 h-full transition-all active:scale-95"
					>
						{isActive && (
							<span className="absolute top-0 left-1/4 right-1/4 h-0.5 rounded-b-full bg-primary" />
						)}
						<Icon
							size={22}
							strokeWidth={isActive ? 2.5 : 2}
							className={cn(
								"transition-all duration-200",
								isActive ? "text-primary" : "text-muted-foreground",
							)}
						/>
						<span
							className={cn(
								"text-[10px] font-semibold leading-tight transition-colors",
								isActive
									? "text-primary"
									: "text-muted-foreground",
							)}
						>
							{tab.label}
						</span>
					</button>
				);
			})}
		</nav>
	);
}
