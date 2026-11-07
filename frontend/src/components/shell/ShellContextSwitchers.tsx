import { Box, Divider, Group, Menu, Paper, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconChevronDown, IconLock, IconUserShield } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSchoolsQuery } from "@/hooks/useSchools";
import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";
import { type ScopedSchool, useSchoolScopeStore } from "@/stores/schoolScopeStore";
import { personaLabel } from "@/utils/personas";
import PersonaSwitcher from "./PersonaSwitcher";
import { SchoolLogo } from "./SchoolScopeSwitcher";

/**
 * 「当前语境」：左院校（作用域）、右视角（权限）。
 *
 * 两种形态共用同一份逻辑：
 * - `header`：桌面顶栏里的内联胶囊，不占侧栏纵向空间；
 * - `card`：移动端抽屉里的一行卡片（顶栏放不下时仍有完整入口）。
 * 不可切换的一方保留锁图标与原值，字段始终在，避免控件时有时无。
 */

function toScoped(school: { id: number; name: string; theme_color?: string | null; has_logo?: boolean; logo_updated_at?: string | null }): ScopedSchool {
	return {
		id: school.id,
		name: school.name,
		themeColor: school.theme_color ?? null,
		hasLogo: !!school.has_logo,
		logoUpdatedAt: school.logo_updated_at ?? null,
	};
}

function LockedInline({ value, hint, icon }: { value: string; hint: string; icon?: React.ReactNode }) {
	return (
		<Tooltip label={hint} withArrow>
			<Group gap={4} wrap="nowrap" style={{ cursor: "default", minWidth: 0 }}>
				{icon ?? <IconLock size={11} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />}
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

	const grantSchools: ScopedSchool[] = (user?.school_personas ?? []).map((grant) => ({
		id: grant.school_id,
		name: grant.school_name,
		// 附加院校的完整品牌不在授予响应里；家院校沿用 /auth/me 的品牌字段。
		themeColor: grant.school_id === user?.school_id ? (user?.school_theme_color ?? null) : null,
		hasLogo: grant.school_id === user?.school_id ? !!user?.school_has_logo : false,
		logoUpdatedAt: grant.school_id === user?.school_id ? (user?.school_logo_updated_at ?? null) : null,
	}));
	const optionSchools = isPlatform ? schools.map(toScoped) : grantSchools;
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
		: canPickSchool
			? "切换当前院校：你被授予了多所院校的视角"
			: "账号固定在本院校（院校边界不可切换）";
	const personaLabelText = personaLabel(activePersona) ?? "—";
	const personaHint = available.length <= 1 ? "账号只有这一个视角" : "当前视角（权限按视角生效）";

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
		const next = toScoped(current);
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
			if (next == null && personaState.active !== "platform") {
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

	const schoolControl = canPickSchool ? (
		<Menu position="bottom-start" width={240} withinPortal>
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
				{(isPlatform ? schools.map(toScoped) : grantSchools).map((school) => {
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

	const personaControl =
		available.length > 1 ? (
			<PersonaSwitcher variant="compact" />
		) : (
			<LockedInline value={personaLabelText} hint={personaHint} icon={<IconUserShield size={11} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />} />
		);

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
				<Box px={8} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>{schoolControl}</Box>
				<Divider orientation="vertical" my={5} />
				<Box px={8} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>{personaControl}</Box>
			</Group>
		);
	}

	return (
		<Paper withBorder radius="md" p={6} mb="sm">
			<Group gap={8} wrap="nowrap" align="center">
				<Group gap={5} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
					<Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ flexShrink: 0 }}>
						院校
					</Text>
					{schoolControl}
				</Group>
				<Divider orientation="vertical" my={2} />
				<Group gap={5} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
					<Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ flexShrink: 0 }}>
						视角
					</Text>
					{personaControl}
				</Group>
			</Group>
		</Paper>
	);
}
