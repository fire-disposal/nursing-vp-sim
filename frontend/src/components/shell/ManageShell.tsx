import { ActionIcon, AppShell, Box, Burger, Button, Group, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLogout, IconMessageCirclePlus, IconStethoscope, IconX } from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, matchPath, useLocation } from "react-router-dom";
import { useFeedback } from "@/components/FeedbackProvider";
import FirstRunFeedbackHint from "@/components/shell/FirstRunFeedbackHint";
import { NetworkBanner } from "@/components/NetworkBanner";
import NotificationBell from "@/components/NotificationBell";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { SHELL } from "@/config/layout-scale";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useShortViewport } from "@/hooks/useShortViewport";
import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";
import { useUiPrefsStore } from "@/stores/uiPrefsStore";
import { isAdminPermissions } from "@/utils/permissions";
import { APP_VERSION } from "@/version";
import { BottomTabBar } from "./BottomTabBar";
import type { NavItem } from "./navigation";
import ShellContextSwitchers from "./ShellContextSwitchers";
import ShellTransition from "./ShellTransition";
import SidebarNav from "./SidebarNav";

/**
 * ManageShell — 统一 Mantine AppShell 布局
 *
 * 桌面端：学生/管理统一使用左侧栏（NavLink 分组，可折叠）。
 * 移动端：底部 Tab 由路由表派生（`nav.mobile`）；**教师轨额外带「更多」**打开完整抽屉——
 * 管理端条目太多（超管 22 项、教师 15 项）放不进底栏，所以底栏只放日常三件，其余靠抽屉可达。
 */
export default function ManageShell({
	userLinks,
	adminLinks,
	onLogout,
	onAbout,
	children,
}: {
	userLinks: NavItem[];
	adminLinks: NavItem[];
	/** 教师/管理端把学生向条目收进独立分组（学生端不受影响） */
	onLogout: () => void;
	onAbout: () => void;
	children: ReactNode;
}) {
	const permissions = useAuthStore((s) => s.permissions);
	const isAdmin = isAdminPermissions(permissions);
	/**
	 * 移动端轨由**当前视角**派生：student → 学生轨，其余 → 教工轨。
	 * 不能再用 `isAdminPermissions`：学生被授予 admin 视角后，在 admin 视角下看学生的底部
	 * Tab 更符合"我在用哪个身份"，而权限推断只会把他永远钉在教工轨。
	 * 没有视角（旧后端 / 未落定）才回落到旧口径。
	 */
	const persona = usePersonaStore((s) => s.active);
	const mobileTier: "student" | "staff" = persona ? (persona === "student" ? "student" : "staff") : isAdmin ? "staff" : "student";
	/** 教工轨要给「更多」（管理端条目放不进底栏）；学生轨不给。 */
	const staffTier = mobileTier === "staff";
	const isOnline = useNetworkStatus();
	const { openFeedback } = useFeedback();
	const { pathname } = useLocation();
	// 横屏/短视口（高度 <500px）：垂直空间宝贵 → 压缩顶栏、默认折叠侧栏、保留底部 Tab
	const isShort = useShortViewport();
	const sidebarCollapsed = useUiPrefsStore((s) => s.sidebarCollapsed);
	const setSidebarCollapsed = useUiPrefsStore((s) => s.setSidebarCollapsed);
	const mobileHintDismissed = useUiPrefsStore((s) => s.mobileHintDismissed);
	const setMobileHintDismissed = useUiPrefsStore((s) => s.setMobileHintDismissed);
	const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
	const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(!sidebarCollapsed);
	/**
	 * 短视口下的临时覆盖（`null` = 还没手动动过）。
	 * 2026-09-30 前这里直接 `closeDesktop()`：横屏手机/投影仪/临时缩小窗口会**把用户的
	 * 桌面侧栏偏好写回 localStorage**，回到大屏也还是折叠的。现在强制折叠只是默认态，
	 * 用户点一下就能在本视口内展开，且永不落盘。
	 */
	const [shortOverride, setShortOverride] = useState<boolean | null>(null);
	const sidebarOpen = isShort ? (shortOverride ?? false) : desktopOpened;
	// 折叠状态持久化：只记录用户在桌面端显式切换的偏好
	useEffect(() => {
		setSidebarCollapsed(!desktopOpened);
	}, [desktopOpened, setSidebarCollapsed]);

	// 路由切换时主内容滚动回顶（避免停留在旧页面滚动位置），并把焦点交给主内容：
	// 否则键盘/读屏用户点完侧栏后焦点还停在导航里，得重新 Tab 穿过 20+ 项才知道页面换了。
	const mainRef = useRef<HTMLDivElement>(null);
	const firstRender = useRef(true);
	const allNavItems = useRef<NavItem[]>([]);
	// 先精确匹配，再按前缀匹配（`/admin/classes/3` 归到「班级管理」）
	const activeLabel =
		allNavItems.current.find((l) => matchPath({ path: l.to, end: true }, pathname))?.label ??
		allNavItems.current.find((l) => matchPath({ path: l.to, end: false }, pathname))?.label ??
		null;

	useEffect(() => {
		document.title = activeLabel ? `${activeLabel} · 虚拟患者训练系统` : "虚拟患者训练系统";
	}, [activeLabel]);

	useEffect(() => {
		mainRef.current?.scrollTo({ top: 0 });
		if (firstRender.current) {
			firstRender.current = false;
			return;
		}
		mainRef.current?.focus({ preventScroll: true });
	}, [pathname]);

	const allLinks = [...userLinks, ...adminLinks];
	// 路由表 → 页面标题（浏览器标签页/历史记录别再全是「虚拟患者训练系统」）
	allNavItems.current = allLinks;
	// 底部 Tab 由路由表派生：本轨有 Tab 才渲染底栏（学生 5 项、教师 3 项 + 更多）
	const hasTabs = allLinks.some((l) => l.mobile?.tier === mobileTier);
	// 「管理后台建议用桌面端」只对**管理页**有意义，而且必须留在内容流里——
	// 它曾挂在壳之外，在 100dvh 的沉浸训练页上把内容顶出视口 27px。
	const showMobileHint = isAdmin && !mobileHintDismissed && pathname.startsWith("/admin");

	return (
		<AppShell
			header={{ height: { base: SHELL.headerHeight, sm: isShort ? SHELL.headerHeightShort : SHELL.headerHeight } }}
			navbar={{
				width: SHELL.sidebarWidth,
				breakpoint: "sm",
				collapsed: { mobile: !mobileOpened, desktop: !sidebarOpen },
			}}
			footer={
				hasTabs
					? {
							height: {
								base: `calc(${SHELL.footerHeight}px + env(safe-area-inset-bottom, 0px))`,
								sm: isShort ? `calc(${SHELL.footerHeight}px + env(safe-area-inset-bottom, 0px))` : 0,
							},
						}
					: undefined
			}
			padding={0}
		>
			{/* 键盘用户的第一跳：DOM 里必须排在最前，否则 Tab 先穿过整条侧栏（20+ 项） */}
			<a href="#main" className="skip-link">
				跳到主内容
			</a>
			<FirstRunFeedbackHint />
			<AppShell.Header>
				<Group h="100%" px="md" gap="sm" wrap="nowrap">
					{staffTier && (
						<Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="切换菜单" />
					)}
					<Burger
						opened={sidebarOpen}
						onClick={() => (isShort ? setShortOverride(!sidebarOpen) : toggleDesktop())}
						visibleFrom="sm"
						size="sm"
						aria-label={sidebarOpen ? "折叠侧边栏" : "展开侧边栏"}
					/>

					<Group gap={8} wrap="nowrap">
						<Box
							component={Link}
							to="/home"
							w={30}
							h={30}
							title="返回首页"
							aria-label="返回首页"
							style={{
								borderRadius: "var(--mantine-radius-md)",
								background:
									"linear-gradient(135deg, var(--mantine-color-brand-6) 0%, var(--mantine-color-brand-8) 100%)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								boxShadow: "var(--mantine-shadow-sm)",
								flexShrink: 0,
								cursor: "pointer",
							}}
						>
							<IconStethoscope size={17} style={{ color: "white" }} />
						</Box>
						<Text fw={700} size="sm" visibleFrom="xs">
							虚拟患者系统
						</Text>
						<UnstyledButton
							onClick={onAbout}
							title="关于系统"
							aria-label="关于系统"
							visibleFrom="sm"
							style={{
								fontSize: 12,
								color: "var(--mantine-color-dimmed)",
								fontVariantNumeric: "tabular-nums",
								padding: "2px 6px",
								borderRadius: "var(--mantine-radius-sm)",
								transition: "color 120ms ease, background 120ms ease",
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.color = "var(--mantine-color-brand-light-color)";
								e.currentTarget.style.background = "var(--mantine-color-brand-light)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.color = "var(--mantine-color-dimmed)";
								e.currentTarget.style.background = "transparent";
							}}
						>
							v{APP_VERSION}
						</UnstyledButton>
					</Group>

					<Box visibleFrom="md" ml={4}>
						<ShellContextSwitchers variant="header" />
					</Box>

					<Group gap={4} ml="auto" wrap="nowrap">
						<ModeToggle />
						<NotificationBell />
						<ActionIcon
							variant="default"
							size={36}
							onClick={openFeedback}
							aria-label="反馈"
							title="反馈"
							hiddenFrom="sm"
							data-feedback-button
						>
							<IconMessageCirclePlus size={16} />
						</ActionIcon>
						<Button
							variant="default"
							size="sm"
							onClick={openFeedback}
							leftSection={<IconMessageCirclePlus size={16} />}
							visibleFrom="sm"
							data-feedback-button
						>
							反馈
						</Button>
						<Tooltip label="退出登录">
							<ActionIcon
								variant="default"
								size={36}
								onClick={onLogout}
								aria-label="退出登录"
								title="退出登录"
							>
								<IconLogout size={16} />
							</ActionIcon>
						</Tooltip>
					</Group>
				</Group>
			</AppShell.Header>

			<AppShell.Navbar p="sm">
				{/* 小屏顶栏放不下语境控件：抽屉里保留同一套入口（桌面见顶栏内联胶囊）。 */}
				<Box hiddenFrom="md">
					<ShellContextSwitchers />
				</Box>
				<SidebarNav
					userLinks={userLinks}
					adminLinks={adminLinks}
					onNavigate={() => mobileOpened && toggleMobile()}
				/>
			</AppShell.Navbar>

			<AppShell.Main ref={mainRef} id="main" tabIndex={-1}>
				{!isOnline && <NetworkBanner />}
				{showMobileHint && (
					<Group
						gap={8}
						px="md"
						py={4}
						hiddenFrom="sm"
						wrap="nowrap"
						style={{
							borderBottom: "1px solid var(--mantine-color-yellow-outline)",
							background: "var(--mantine-color-yellow-light)",
						}}
					>
						<Text size="xs" c="var(--mantine-color-yellow-light-color)" style={{ flex: 1 }}>
							管理后台建议使用桌面端访问以获得完整体验
						</Text>
						<ActionIcon
							variant="transparent"
							color="var(--mantine-color-yellow-light-color)"
							size="xs"
							onClick={() => setMobileHintDismissed(true)}
							aria-label="关闭提示"
						>
							<IconX size={13} />
						</ActionIcon>
					</Group>
				)}
				{/* 内容容器：超宽屏不贴边（表格仍可横向滚动）。内边距唯一来源 = global.css 的
				    .shell-content（同时暴露 --shell-content-pad 给需要整屏高度的页面，如 QA 工作台）。 */}
				<Box className="shell-content" maw={SHELL.contentMaxWidth} mx="auto" style={{ width: "100%" }}>
					<ShellTransition>{children}</ShellTransition>
				</Box>
			</AppShell.Main>

			{hasTabs && (
				<AppShell.Footer>
					<BottomTabBar
						links={allLinks}
						onOpenNav={staffTier ? toggleMobile : undefined}
						tier={mobileTier}
					/>
				</AppShell.Footer>
			)}
		</AppShell>
	);
}
