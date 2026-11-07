import { Avatar, Box, Divider, Group, NavLink as MantineNavLink, ScrollArea, Text } from "@mantine/core";
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";
import { personaLabel } from "@/utils/personas";
import type { NavGroupKey, NavItem } from "./navigation";
import { NAV_GROUPS } from "./navigation";

function isActive(pathname: string, to: string, end?: boolean): boolean {
	if (end) return pathname === to;
	return pathname === to || pathname.startsWith(`${to}/`);
}

function SideNavLink({ link, onNavigate }: { link: NavItem; onNavigate: () => void }) {
	const { pathname } = useLocation();
	const Icon = link.icon;
	return (
		<MantineNavLink
			component={Link}
			to={link.to}
			label={link.label}
			leftSection={<Icon size={18} stroke={1.75} />}
			active={isActive(pathname, link.to, link.end)}
			onClick={onNavigate}
		/>
	);
}

/**
 * 侧栏导航：**平铺 + 分隔线**，不再做二级折叠。
 *
 * 分组标题折叠在此前的信息密度下有必要，但语境移入顶栏后侧栏本身已很短；
 * 再折叠会让常用入口多一次点击，且分组标题与图标重复表达同一件事。现在只保留
 * 分隔线区分「我的训练 / 管理分组」，所有条目一眼可见。
 */
export default function SidebarNav({
	userLinks,
	adminLinks,
	onNavigate,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	onNavigate: () => void;
}) {
	const user = useAuthStore((s) => s.user);
	const avatar = getUserAvatar(user?.gender);

	const blocks = useMemo(() => {
		const grouped = new Map<NavGroupKey, NavItem[]>();
		const ungrouped: NavItem[] = [];
		for (const link of adminLinks) {
			if (link.group) {
				if (!grouped.has(link.group)) grouped.set(link.group, []);
				grouped.get(link.group)!.push(link);
			} else {
				ungrouped.push(link);
			}
		}
		const result: NavItem[][] = [];
		if (userLinks.length > 0) result.push(userLinks);
		if (ungrouped.length > 0) result.push(ungrouped);
		for (const group of NAV_GROUPS) {
			const links = grouped.get(group.key);
			if (links && links.length > 0) result.push(links);
		}
		return result;
	}, [userLinks, adminLinks]);

	return (
		<Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<ScrollArea style={{ flex: 1 }}>
				<Box px="xs" py="xs">
					{blocks.map((links, index) => (
						<Box key={links[0]?.to ?? index}>
							{index > 0 && <Divider my="xs" />}
							{links.map((link) => (
								<SideNavLink key={link.to} link={link} onNavigate={onNavigate} />
							))}
						</Box>
					))}
				</Box>
			</ScrollArea>

			<Divider />
			{/* 底部只显示"我是谁"：全局操作在顶栏，个人中心入口是导航里的「我的」。 */}
			<Box p="sm">
				<Group gap="sm" wrap="nowrap" px="xs">
					<Avatar src={avatar} size={32} radius="xl" />
					<Box style={{ minWidth: 0 }}>
						<Text size="sm" fw={500} truncate>
							{user?.display_name ?? "用户"}
						</Text>
						<Text size="xs" c="dimmed" truncate>
							{personaLabel(user?.active_persona ?? null) ?? "用户"}
						</Text>
					</Box>
				</Group>
			</Box>
		</Box>
	);
}
