import { Group, Text, Transition, UnstyledButton } from "@mantine/core";
import { IconDots } from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortViewport } from "@/hooks/useShortViewport";
import useAuthStore from "@/stores/authStore";
import { isAdminPermissions } from "@/utils/permissions";
import type { NavIcon, NavItem } from "./navigation";

/** 去掉查询串，拿到用于高亮比较的路径（Tab 的 `to` 可以带筛选参数）。 */
function pathOf(to: string): string {
	const q = to.indexOf("?");
	return q === -1 ? to : to.slice(0, q);
}

function isTabActive(pathname: string, to: string, activeOn: string[]): boolean {
	const root = pathOf(to);
	if (pathname === root || pathname.startsWith(`${root}/`)) return true;
	return activeOn.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

interface TabSpec {
	key: string;
	to: string;
	label: string;
	icon: NavIcon;
	activeOn: string[];
}

/**
 * BottomTabBar — 移动端底部导航。
 *
 * **单一来源**：Tab 内容由路由表的 `nav.mobile` 派生（2026-09-30 前这里硬编码了一份
 * `BOTTOM_TABS`，与 `navigation.tsx` 各维护一套权限与顺序；新增/删除页面要改两处，
 * 遗漏时桌面有入口、手机没有）。
 *
 * 教师与学生是两套 Tab（`mobile.tier`）：教师的日常是"看板/待批阅/作业"，学生是
 * "训练/记录/问答"。管理端的 15–22 个条目放不进底栏，所以管理轨另给一个「更多」
 * （打开侧栏抽屉）——它不是装饰，是保证管理端每个页面在手机上仍可达的唯一出口。
 */
export function BottomTabBar({
	links,
	onOpenNav,
}: {
	links: NavItem[];
	/** 传入即渲染「更多」Tab（打开完整菜单）；管理轨必须传，学生轨不传。 */
	onOpenNav?: () => void;
}) {
	const location = useLocation();
	const navigate = useNavigate();
	const permissions = useAuthStore((s) => s.permissions);
	const tier = isAdminPermissions(permissions) ? "staff" : "student";
	const tabs: TabSpec[] = links
		.filter((l) => l.mobile?.tier === tier)
		.sort((a, b) => (a.mobile?.order ?? 0) - (b.mobile?.order ?? 0))
		.map((l) => ({
			key: l.to,
			to: l.mobile?.to ?? l.to,
			label: l.mobile?.label ?? l.label,
			icon: l.icon,
			activeOn: l.mobile?.activeOn ?? [],
		}));
	// 横屏/短视口也显示底部 Tab（垂直空间宝贵，侧栏已折叠，Tab 承担导航）
	const isShort = useShortViewport();

	if (tabs.length === 0 && !onOpenNav) return null;

	const renderTab = (
		key: string,
		label: string,
		Icon: NavIcon,
		active: boolean,
		onClick: () => void,
	) => (
		<UnstyledButton
			key={key}
			onClick={onClick}
			aria-current={active ? "page" : undefined}
			aria-label={label}
			style={{
				position: "relative",
				flex: 1,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 3,
				height: "100%",
			}}
		>
			<Transition mounted={active} transition="fade" duration={180}>
				{(styles) => (
					<span
						style={{
							...styles,
							position: "absolute",
							top: 0,
							left: "25%",
							right: "25%",
							height: 3,
							borderRadius: "0 0 999px 999px",
							background: "var(--mantine-color-brand-6)",
						}}
					/>
				)}
			</Transition>
			<Icon
				size={22}
				stroke={active ? 2.5 : 1.9}
				style={{
					color: active ? "var(--mantine-color-brand-6)" : "var(--mantine-color-dimmed)",
					transition: "color 150ms ease",
				}}
			/>
			<Text
				fz={12}
				fw={active ? 700 : 500}
				c={active ? "brand.6" : "dimmed"}
				style={{ lineHeight: 1, transition: "color 150ms ease" }}
			>
				{label}
			</Text>
		</UnstyledButton>
	);

	return (
		<Group
			component="nav"
			justify="space-around"
			gap={0}
			hiddenFrom={isShort ? undefined : "sm"}
			h="100%"
			style={{
				borderTop: "1px solid var(--mantine-color-default-border)",
				background: "var(--mantine-color-body)",
				paddingBottom: "env(safe-area-inset-bottom, 0px)",
			}}
		>
			{tabs.map((tab) =>
				renderTab(
					tab.key,
					tab.label,
					tab.icon,
					isTabActive(location.pathname, tab.to, tab.activeOn),
					() => navigate(tab.to),
				),
			)}
			{onOpenNav &&
				renderTab("__more", "更多", IconDots, false, onOpenNav)}
		</Group>
	);
}
