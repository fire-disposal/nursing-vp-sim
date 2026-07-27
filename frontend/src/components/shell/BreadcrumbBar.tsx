import { ChevronRight, Home } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { AppRoute, NavMeta } from "./navigation";
import { APP_ROUTES } from "./navigation";

interface Crumb {
	label: string;
	to?: string;
}

function findRoute(pathname: string): (AppRoute & { nav: NavMeta }) | undefined {
	for (const route of APP_ROUTES) {
		if (!route.nav) continue;
		if (route.path === pathname) return route as AppRoute & { nav: NavMeta };
		const pattern = route.path.replace(/:\w+/g, "[^/]+");
		if (new RegExp(`^${pattern}$`).test(pathname)) return route as AppRoute & { nav: NavMeta };
	}
}

/**
 * BreadcrumbBar — 路由感知的面包屑导航
 *
 * 从当前路径推导层级关系，在所有 Shell 中共享。
 */
export default function BreadcrumbBar({ className }: { className?: string }) {
	const { pathname } = useLocation();

	const crumbs = useMemo<Crumb[]>(() => {
		const result: Crumb[] = [{ label: "首页", to: "/home" }];

		const route = findRoute(pathname);
		if (!route || route.path === "/home") return result;

		// Add parent if it's a sub-route (training/:id → 病例训练, record/:id → 训练记录, admin/users/:id → 用户管理)
		if (pathname.startsWith("/training/") && pathname !== "/training") {
			result.push({ label: "病例训练", to: "/training" });
		} else if (pathname.startsWith("/record/")) {
			result.push({ label: "训练记录", to: "/history" });
		} else if (pathname.startsWith("/admin/records/") && pathname !== "/admin/records") {
			result.push({ label: "训练记录", to: "/admin/records" });
		} else if (pathname.startsWith("/admin/users/") && pathname !== "/admin/users") {
			result.push({ label: "用户管理", to: "/admin/users" });
		} else if (pathname.startsWith("/admin/assignments/") && pathname !== "/admin/assignments") {
		result.push({ label: "作业管理", to: "/admin/assignments" });
		}

		result.push({ label: route.nav.label });
		return result;
	}, [pathname]);

	return (
		<nav
			aria-label="面包屑导航"
			className={`flex items-center gap-1 text-xs text-muted-foreground ${className ?? ""}`}
		>
			{crumbs.map((crumb, i) => (
				<span key={i} className="flex items-center gap-1">
					{i > 0 && <ChevronRight size={12} className="shrink-0" />}
					{crumb.to ? (
						<NavLink
							to={crumb.to}
							className="hover:text-foreground transition-colors truncate max-w-[120px]"
						>
							{crumb.label}
						</NavLink>
					) : (
						<span className="font-medium text-foreground truncate max-w-[160px]">
							{crumb.label}
						</span>
					)}
				</span>
			))}
		</nav>
	);
}
