import {
	Avatar,
	Box,
	Divider,
	NavLink as MantineNavLink,
	ScrollArea,
} from "@mantine/core";
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";
import type { NavGroupKey, NavItem } from "./navigation";
import { IconStethoscope } from "@tabler/icons-react";
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

function SideNavGroup({
	group,
	links,
	onNavigate,
}: {
	group: (typeof NAV_GROUPS)[number];
	links: NavItem[];
	onNavigate: () => void;
}) {
	const { pathname } = useLocation();
	const GroupIcon = group.icon;
	const hasActive = links.some((l) => isActive(pathname, l.to, l.end));
	return (
		<MantineNavLink
			label={group.label}
			leftSection={<GroupIcon size={18} stroke={1.75} />}
			defaultOpened={group.defaultOpen || hasActive}
			childrenOffset={14}
		>
			{links.map((link) => (
				<SideNavLink key={link.to} link={link} onNavigate={onNavigate} />
			))}
		</MantineNavLink>
	);
}

/**
 * AdminSidebarNav — 管理端侧边导航（Mantine NavLink 可折叠分组）
 */
export default function SidebarNav({
	userLinks,
	adminLinks,
	onNavigate,
	groupUserLinks = false,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	onNavigate: () => void;
	/**
	 * 教师/管理端：把学生向条目（训练/记录/问答/我的）收进"我的训练"分组，
	 * 避免它们与管理分组混在一起平铺。学生端传 false → 渲染保持不变。
	 */
	groupUserLinks?: boolean;
}) {
	const user = useAuthStore((s) => s.user);
	const avatar = getUserAvatar(user?.gender);

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
		<Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<ScrollArea style={{ flex: 1 }}>
				<Box px="xs" py="xs">
					{groupUserLinks ? (
						userLinks.length > 0 && (
							<SideNavGroup
								group={{ key: "personal", label: "我的训练", icon: IconStethoscope, defaultOpen: false }}
								links={userLinks}
								onNavigate={onNavigate}
							/>
						)
					) : (
						userLinks.map((link) => <SideNavLink key={link.to} link={link} onNavigate={onNavigate} />)
					)}

					{ungrouped.length > 0 && (
						<>
							<Divider my="sm" />
							{ungrouped.map((link) => (
								<SideNavLink key={link.to} link={link} onNavigate={onNavigate} />
							))}
						</>
					)}

					{NAV_GROUPS.map((group) => {
						const links = grouped.get(group.key);
						if (!links || links.length === 0) return null;
						return <SideNavGroup key={group.key} group={group} links={links} onNavigate={onNavigate} />;
					})}
				</Box>
			</ScrollArea>

			<Divider />
			{/* 底部仅用户卡（点击进个人中心）；全局操作（模式/通知/反馈/退出）统一在顶栏 */}
			<Box p="sm">
				<MantineNavLink
					component={Link}
					to="/profile"
					label={user?.display_name ?? "用户"}
					description={user?.role_display_name || user?.role || "用户"}
					leftSection={<Avatar src={avatar} size={32} radius="xl" />}
					onClick={onNavigate}
				/>
			</Box>
		</Box>
	);
}
