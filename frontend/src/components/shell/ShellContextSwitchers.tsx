import { Box, Divider, Group, Menu, Paper, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconChevronDown, IconLock } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSchoolsQuery } from "@/hooks/useSchools";
import useAuthStore from "@/stores/authStore";
import { isPlatformOnlyPersona } from "@/utils/personas";
import { usePersonaStore } from "@/stores/personaStore";
import { type ScopedSchool, SCHOOL_MENU_REQUEST_EVENT, toScopedSchool, useSchoolScopeStore } from "@/stores/schoolScopeStore";
import PersonaSwitcher from "./PersonaSwitcher";
import { SchoolLogo } from "./SchoolScopeSwitcher";

/**
 * 「当前语境」：左院校（作用域）、右视角（权限）。
 *
 * 两种形态共用同一份逻辑：
 * - `header`：桌面顶栏里的内联胶囊，不占侧栏纵向空间；
 * - `card`：移动端抽屉里的一行卡片（顶栏放不下时仍有完整入口）。
 *
 * **单一语境不显示控件**：只有一所院校 + 一个视角的账号（绝大多数学生/教师）看不到
 * 这段壳层，操作与普通系统无异；多校/多视角账号只显示**能变的那一侧**，避免
 * "锁着的控件"造成"这里本来该能点"的错觉。
 */


function LockedInline({ value, hint }: { value: string; hint: string }) {
	return (
		<Tooltip label={hint} withArrow>
			<Group gap={4} wrap="nowrap" style={{ cursor: "default", minWidth: 0 }}>
				<IconLock size={11} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
				<Text size="xs" c="dimmed" truncate>
					{value}
				</Text>
			</Group>
		</Tooltip>
	);
}

export default function ShellContextSwitchers({ variant = "card" }: { variant?: "card" | "header" }) {
	const permissions = useAuthStore((s) => s.permissions);
	const user = useAuthStore((s) => s.user);
	const isPlatform = user?.is_platform === true;
	const canManageSchools = permissions.includes("school_manage");
	const available = usePersonaStore((s) => s.available);
	const activePersona = usePersonaStore((s) => s.active);
	// 平台账号在任意视角都需要院校清单；普通多校账号用 /auth/me 返回的授予列表。
	const { data: schools = [] } = useSchoolsQuery({ enabled: isPlatform || canManageSchools });
	const scoped = useSchoolScopeStore((s) => s.school);
	const setSchool = useSchoolScopeStore((s) => s.setSchool);
	const queryClient = useQueryClient();
	const location = useLocation();
	const navigate = useNavigate();
	// 平台账号在"全部院校"下点非平台视角时，由 PersonaSwitcher 请求打开院校菜单，
	// 把"先选院校"从一句 toast 变成直接可操作的下一步。
	const [schoolMenuOpen, setSchoolMenuOpen] = useState(false);
	useEffect(() => {
		const handler = () => {
			// 顶栏与抽屉各有一份语境控件；只让当前可见的那一份响应，
			// 否则两个 Menu 会同时打开（门户里出现两份院校列表）。
			const desktop = window.matchMedia("(min-width: 62em)").matches;
			if ((variant === "header") === desktop) setSchoolMenuOpen(true);
		};
		window.addEventListener(SCHOOL_MENU_REQUEST_EVENT, handler);
		return () => window.removeEventListener(SCHOOL_MENU_REQUEST_EVENT, handler);
	}, [variant]);

	const grantSchools: ScopedSchool[] = (user?.school_personas ?? []).map((grant) => ({
		id: grant.school_id,
		name: grant.school_name,
		// 附加院校的完整品牌不在授予响应里；家院校沿用 /auth/me 的品牌字段。
		themeColor: grant.school_id === user?.school_id ? (user?.school_theme_color ?? null) : null,
		hasLogo: grant.school_id === user?.school_id ? !!user?.school_has_logo : false,
		logoUpdatedAt: grant.school_id === user?.school_id ? (user?.school_logo_updated_at ?? null) : null,
	}));
	const optionSchools = isPlatform ? schools.map(toScopedSchool) : grantSchools;
	const homeSchool = !isPlatform && user?.school_id != null
		? (grantSchools.find((school) => school.id === user.school_id) ?? {
				id: user.school_id,
				name: user.school_name ?? "本院校",
				themeColor: user.school_theme_color ?? null,
				hasLogo: !!user.school_has_logo,
				logoUpdatedAt: user.school_logo_updated_at ?? null,
			})
		: null;
	const scopedSchool = scoped && optionSchools.some((school) => school.id === scoped.id) ? scoped : null;
	const activeSchool = scopedSchool ?? homeSchool;
	const canPickSchool = isPlatform ? optionSchools.length > 0 : optionSchools.length > 1;
	const schoolName = isPlatform ? (scopedSchool?.name ?? "全部院校") : (activeSchool?.name ?? "未绑定院校");
	const schoolHint = isPlatform
		? "切换当前院校：列表、统计与新建都会跟随"
		: "切换当前院校：你被授予了多所院校的视角";

	// 单校 + 单视角：整段语境对用户不可见（身份已在侧栏底部与个人中心）。
	// 多校/多视角账号只显示能变的一侧，不摆"锁着的控件"。
	const showSchoolControl = isPlatform || canPickSchool;
	const showPersonaControl = available.length > 1 && !!activePersona;

	// 院校改名/换院徽/被删除时同步本地快照：快照供顶栏与主题使用，不能一直停在旧值。
	// 列表为空（请求失败）时不动，避免网络抖动把当前作用域清掉。
	useEffect(() => {
		if (!isPlatform) {
			if (scoped && optionSchools.length > 0 && !optionSchools.some((school) => school.id === scoped.id)) {
				setSchool(null);
				queryClient.clear();
			}
			return;
		}
		if (!scoped || schools.length === 0) return;
		const current = schools.find((school) => school.id === scoped.id);
		if (!current) {
			setSchool(null);
			queryClient.clear();
			return;
		}
		const next = toScopedSchool(current);
		if (
			next.name !== scoped.name ||
			next.themeColor !== scoped.themeColor ||
			next.hasLogo !== scoped.hasLogo ||
			next.logoUpdatedAt !== scoped.logoUpdatedAt
		) {
			setSchool(next);
		}
	}, [isPlatform, optionSchools, schools, scoped, setSchool, queryClient]);

	const changeSchool = async (next: ScopedSchool | null) => {
		setSchool(next);
		// 换校可能换掉该账号在该校的授予集合：先把“目标视角”对齐，再让 /auth/me
		// 带着新 school+persona 解析；否则旧 persona 在目标校未授予会 403，
		// authStore 会把刚选的学校又清掉。
		const personaState = usePersonaStore.getState();
		if (isPlatform) {
			// 切回“全部院校”时，院校视角失去作用域，需要落到 platform；
			// 但 platform / ops 本身就是全局视角，不能把正在看的运维页切走。
			if (next == null && !isPlatformOnlyPersona(personaState.active)) {
				personaState.setAvailable(personaState.available, "platform");
			}
		} else if (next != null) {
			const target = user?.school_personas?.find((grant) => grant.school_id === next.id);
			const targetPersonas = target?.personas ?? [];
			if (targetPersonas.length > 0 && !targetPersonas.includes(personaState.active ?? "")) {
				personaState.setAvailable(targetPersonas, targetPersonas[0]);
			}
		}
		const query = new URLSearchParams(location.search);
		const stale = ["class_id", "cohort_label", "school_id", "assignment_id"].filter((key) => query.has(key));
		for (const key of stale) query.delete(key);
		// 详情页（/admin/users/12 等）属于切换前的院校：留在原地会 404 或显示旧实体。
		// 回到同一模块的列表根，列表用新作用域重取。
		const detail = location.pathname.match(/^\/admin\/(users|assignments|classes|records)\/\d+(?:\/|$)/);
		const pathname = detail ? `/admin/${detail[1]}` : location.pathname;
		if (pathname !== location.pathname || stale.length > 0) {
			navigate({ pathname, search: query.toString() }, { replace: true });
		} else if (!isPlatform) {
			// 普通账号换校可能改变该账号在该校的授予/视角；回首页由权限门重新决定落点。
			navigate("/home", { replace: true });
		}
		// 与换视角同一口径：院校维度的缓存不再成立。`clear` 而不是 `invalidate`——
		// 旧院校的详情/列表缓存不能在新作用域下先闪一下再重取。
		queryClient.clear();
		await useAuthStore.getState().refreshUser();
	};

	// 单一语境不渲染：学生/单校教师看到的壳与普通系统一致。
	if (!showSchoolControl && !showPersonaControl) return null;

	const schoolControl = canPickSchool ? (
		<Menu
			position="bottom-start"
			width={240}
			withinPortal
			opened={schoolMenuOpen}
			onChange={setSchoolMenuOpen}
		>
			<Menu.Target>
				<UnstyledButton
					aria-label="切换院校"
					title="切换当前院校：列表、统计与新建都会跟随"
					style={{ minWidth: 0, maxWidth: 180 }}
				>
					<Group gap={5} wrap="nowrap">
						<SchoolLogo school={activeSchool} size={14} />
						<Text size="xs" fw={600} truncate>
							{schoolName}
						</Text>
						<IconChevronDown size={12} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
					</Group>
				</UnstyledButton>
			</Menu.Target>
			<Menu.Dropdown>
				<Menu.Label>院校作用域</Menu.Label>
				{isPlatform && (
					<Menu.Item
						onClick={() => changeSchool(null)}
						leftSection={scopedSchool ? <span style={{ width: 14 }} /> : <IconCheck size={14} />}
					>
						全部院校
					</Menu.Item>
				)}
				{(isPlatform ? schools.map(toScopedSchool) : grantSchools).map((school) => {
					const selected = activeSchool?.id === school.id;
					return (
						<Menu.Item
							key={school.id}
							onClick={() => changeSchool(school)}
							leftSection={selected ? <IconCheck size={14} /> : <span style={{ width: 14 }} />}
							rightSection={<SchoolLogo school={school} size={14} />}
						>
							{school.name}
						</Menu.Item>
					);
				})}
			</Menu.Dropdown>
		</Menu>
	) : (
		<LockedInline value={schoolName} hint={schoolHint} />
	);

	const personaControl = <PersonaSwitcher variant="compact" />;

	if (variant === "header") {
		return (
			<Group
				gap={0}
				wrap="nowrap"
				style={{
					border: "1px solid var(--mantine-color-default-border)",
					borderRadius: "var(--mantine-radius-md)",
					background: "var(--mantine-color-body)",
					overflow: "hidden",
					height: 30,
				}}
			>
				{showSchoolControl && <Box px={8} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>{schoolControl}</Box>}
				{showSchoolControl && showPersonaControl && <Divider orientation="vertical" my={5} />}
				{showPersonaControl && <Box px={8} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>{personaControl}</Box>}
			</Group>
		);
	}

	return (
		<Paper withBorder radius="md" p={6} mb="sm">
			<Group gap={8} wrap="nowrap" align="center">
				{showSchoolControl && (
					<Group gap={5} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
						<Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ flexShrink: 0 }}>
							院校
						</Text>
						{schoolControl}
					</Group>
				)}
				{showSchoolControl && showPersonaControl && <Divider orientation="vertical" my={2} />}
				{showPersonaControl && (
					<Group gap={5} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
						<Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ flexShrink: 0 }}>
							视角
						</Text>
						{personaControl}
					</Group>
				)}
			</Group>
		</Paper>
	);
}
