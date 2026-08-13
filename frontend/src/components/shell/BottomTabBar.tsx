import { Group, Text, UnstyledButton } from "@mantine/core";
import { IconClipboardList, IconRobot, IconStethoscope, IconUser } from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortViewport } from "@/hooks/useShortViewport";
import type { NavIcon } from "./navigation";

/**
 * 判断当前路径是否属于某个 Tab 的活动范围。
 * 例如 "记录" Tab 覆盖 /history, /record/:id；"我的" Tab 覆盖 /profile, /notifications, /my-feedback。
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
}> = [
	{
		to: "/training",
		icon: IconStethoscope,
		label: "训练",
		activeOn: ["/training"],
	},
	{
		to: "/history",
		icon: IconClipboardList,
		label: "记录",
		activeOn: ["/record"],
	},
	{
		to: "/qa",
		icon: IconRobot,
		label: "问答",
		activeOn: ["/qa"],
	},
	{
		to: "/profile",
		icon: IconUser,
		label: "我的",
		activeOn: ["/notifications", "/my-feedback"],
	},
];

/**
 * BottomTabBar — 移动端底部 4 Tab 导航栏
 * 训练 | 记录 | 问答 | 我的
 * 仅在 sm 断点（768px）以下显示（hiddenFrom="sm"）。短视口压缩为仅图标。
 */
export function BottomTabBar() {
	const location = useLocation();
	const navigate = useNavigate();
	const isShort = useShortViewport();

	return (
		<Group
			component="nav"
			justify="space-around"
			gap={0}
			hiddenFrom="sm"
			style={{
				flexShrink: 0,
				borderTop: "1px solid var(--mantine-color-gray-3)",
				background: "var(--mantine-color-body)",
				paddingBottom: isShort ? 0 : "env(safe-area-inset-bottom, 0px)",
				height: isShort ? 40 : "calc(56px + env(safe-area-inset-bottom, 0px))",
			}}
		>
			{BOTTOM_TABS.map((tab) => {
				const Icon = tab.icon;
				const isActive = isTabActive(location.pathname, tab.to, tab.activeOn);
				return (
					<UnstyledButton
						key={tab.to}
						onClick={() => navigate(tab.to)}
						style={{
							position: "relative",
							flex: 1,
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							height: "100%",
						}}
					>
						{isActive && (
							<span
								style={{
									position: "absolute",
									top: 0,
									left: "25%",
									right: "25%",
									height: 2,
									borderRadius: "0 0 999px 999px",
									background: "var(--mantine-color-blue-6)",
								}}
							/>
						)}
						<Icon
							size={isShort ? 20 : 22}
							stroke={isActive ? 2.5 : 2}
							style={{
								color: isActive ? "var(--mantine-color-blue-6)" : "var(--mantine-color-dimmed)",
							}}
						/>
						{!isShort && (
							<Text
								fz={10}
								fw={600}
								c={isActive ? "blue.6" : "dimmed"}
								style={{ lineHeight: 1.2 }}
							>
								{tab.label}
							</Text>
						)}
					</UnstyledButton>
				);
			})}
		</Group>
	);
}
