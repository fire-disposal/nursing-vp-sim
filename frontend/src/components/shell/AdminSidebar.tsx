import {
	Avatar,
	Box,
	Button,
	Divider,
	Group,
	NavLink as MantineNavLink,
	ScrollArea,
	Tooltip,
} from "@mantine/core";
import { IconLogout, IconMessageCirclePlus } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import NotificationBell from "@/components/NotificationBell";
import { ModeToggle } from "@/components/ui/mode-toggle";
import useAuthStore from "@/stores/authStore";
import { getUserAvatar } from "@/utils/avatar";
import { APP_VERSION } from "@/version";
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
export default function AdminSidebarNav({
	userLinks,
	adminLinks,
	onNavigate,
	onLogout,
	onAbout,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	onNavigate: () => void;
	onLogout: () => void;
	onAbout: () => void;
}) {
	const user = useAuthStore((s) => s.user);
	const avatar = getUserAvatar(user?.gender);
	const { openFeedback } = useFeedback();

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
					{userLinks.map((link) => (
						<SideNavLink key={link.to} link={link} onNavigate={onNavigate} />
					))}

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
			<Box p="sm">
				<MantineNavLink
					component={Link}
					to="/profile"
					label={user?.display_name ?? "用户"}
					description={user?.role_display_name || user?.role || "用户"}
					leftSection={<Avatar src={avatar} size={32} radius="xl" />}
					onClick={onNavigate}
					mb="sm"
				/>
				<Group gap={4} wrap="nowrap">
					<ModeToggle />
					<NotificationBell />
					<Tooltip label="意见反馈">
						<Button variant="default" size="sm" w={36} h={36} p={0} onClick={openFeedback} aria-label="意见反馈">
							<IconMessageCirclePlus size={16} />
						</Button>
					</Tooltip>
					<Tooltip label="退出登录">
						<Button variant="default" size="sm" color="red" w={36} h={36} p={0} onClick={onLogout} aria-label="退出登录">
							<IconLogout size={16} />
						</Button>
					</Tooltip>
				</Group>
				<Button variant="transparent" size="xs" w="100%" mt="xs" onClick={onAbout}>
					v{APP_VERSION}
				</Button>
			</Box>
		</Box>
	);
}
