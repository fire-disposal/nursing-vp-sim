import { Group, Text, Transition, UnstyledButton } from "@mantine/core";
import { IconClipboardList, IconRobot, IconSitemap, IconStethoscope, IconUser } from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortViewport } from "@/hooks/useShortViewport";
import useAuthStore from "@/stores/authStore";
import type { Permission } from "@/utils/permissions";
import type { NavIcon } from "./navigation";

/**
 * 判断当前路径是否属于某个 Tab 的活动范围。
 */
function isTabActive(pathname: string, root: string, subPrefixes: string[]): boolean {
	if (pathname === root || pathname.startsWith(`${root}/`)) return true;
	return subPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const BOTTOM_TABS: Array<{
	to: string;
	icon: NavIcon;
	label: string;
	activeOn: string[];
	/** 有权限键才出现的 Tab（口径与 Layout 对 `NAV_ITEMS` 的过滤一致）；不写 = 恒显示 */
	permission?: Permission;
}> = [
	{ to: "/training", icon: IconStethoscope, label: "训练", activeOn: ["/training"] },
	{ to: "/scenario", icon: IconSitemap, label: "情境", activeOn: [], permission: "scenario_training" },
	{ to: "/history", icon: IconClipboardList, label: "记录", activeOn: ["/record"] },
	{ to: "/qa", icon: IconRobot, label: "问答", activeOn: ["/qa"] },
	{ to: "/profile", icon: IconUser, label: "我的", activeOn: ["/notifications", "/my-feedback"] },
];

/**
 * BottomTabBar — 移动端底部 Tab 导航栏（基础四项，加有权限的实验入口如「情境」）。
 * 由 AppShell.Footer 固定定位，此处只负责内容渲染。
 * 活动态使用品牌青绿 + Mantine Transition 平滑指示条（尊重减弱动态偏好）。
 */
export function BottomTabBar() {
	const location = useLocation();
	const navigate = useNavigate();
	const permissions = useAuthStore((s) => s.permissions);
	const tabs = BOTTOM_TABS.filter((tab) => !tab.permission || permissions.includes(tab.permission));
	// 横屏/短视口也显示底部 Tab（垂直空间宝贵，侧栏已折叠，Tab 承担导航）
	const isShort = useShortViewport();

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
			{tabs.map((tab) => {
				const Icon = tab.icon;
				const isActive = isTabActive(location.pathname, tab.to, tab.activeOn);
				return (
					<UnstyledButton
						key={tab.to}
						onClick={() => navigate(tab.to)}
						aria-current={isActive ? "page" : undefined}
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
						<Transition mounted={isActive} transition="fade" duration={180}>
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
							stroke={isActive ? 2.5 : 1.9}
							style={{
								color: isActive ? "var(--mantine-color-brand-6)" : "var(--mantine-color-dimmed)",
								transition: "color 150ms ease",
							}}
						/>
						<Text
							fz={12}
							fw={isActive ? 700 : 500}
							c={isActive ? "brand.6" : "dimmed"}
							style={{ lineHeight: 1, transition: "color 150ms ease" }}
						>
							{tab.label}
						</Text>
					</UnstyledButton>
				);
			})}
		</Group>
	);
}
