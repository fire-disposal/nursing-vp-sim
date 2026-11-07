import { Box, Divider, Group, Menu, Paper, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconChevronDown, IconLock, IconUserShield } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
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
	const canManageSchools = permissions.includes("school_manage");
	const available = usePersonaStore((s) => s.available);
	const activePersona = usePersonaStore((s) => s.active);
	const { data: schools = [] } = useSchoolsQuery({ enabled: canManageSchools });
	const scoped = useSchoolScopeStore((s) => s.school);
	const setSchool = useSchoolScopeStore((s) => s.setSchool);
	const queryClient = useQueryClient();
	const location = useLocation();
	const navigate = useNavigate();

	const hasMultiSchool = canManageSchools && schools.length > 1;
	const schoolName = canManageSchools
		? (scoped?.name ?? "全部院校")
		: (user?.school_name ?? (user?.is_platform ? "平台" : "未绑定院校"));
	const schoolHint = canManageSchools
		? schools.length <= 1
			? "当前只有一所院校，无需切换"
			: "切换当前院校：列表、统计与新建都会跟随"
		: "账号固定在本院校（院校边界不可切换）";
	const personaLabelText = personaLabel(activePersona) ?? "—";
	const personaHint = available.length <= 1 ? "账号只有这一个视角" : "当前视角（权限按视角生效）";

	const changeSchool = (next: ScopedSchool | null) => {
		setSchool(next);
		const query = new URLSearchParams(location.search);
		const stale = ["class_id", "cohort_label", "school_id"].filter((key) => query.has(key));
		if (stale.length > 0) {
			for (const key of stale) query.delete(key);
			navigate({ pathname: location.pathname, search: query.toString() }, { replace: true });
		}
		void queryClient.invalidateQueries();
	};

	const schoolControl = hasMultiSchool ? (
		<Menu position="bottom-start" width={240} withinPortal>
			<Menu.Target>
				<UnstyledButton
					aria-label="切换院校"
					title="切换当前院校：列表、统计与新建都会跟随"
					style={{ minWidth: 0, maxWidth: 180 }}
				>
					<Group gap={5} wrap="nowrap">
						<SchoolLogo school={scoped} size={14} />
						<Text size="xs" fw={600} truncate>
							{schoolName}
						</Text>
						<IconChevronDown size={12} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
					</Group>
				</UnstyledButton>
			</Menu.Target>
			<Menu.Dropdown>
				<Menu.Label>院校作用域</Menu.Label>
				<Menu.Item
					onClick={() => changeSchool(null)}
					leftSection={scoped ? <span style={{ width: 14 }} /> : <IconCheck size={14} />}
				>
					全部院校
				</Menu.Item>
				{schools.map((school) => {
					const item = toScoped(school);
					const selected = scoped?.id === school.id;
					return (
						<Menu.Item
							key={school.id}
							onClick={() => changeSchool(item)}
							leftSection={selected ? <IconCheck size={14} /> : <span style={{ width: 14 }} />}
							rightSection={<SchoolLogo school={item} size={14} />}
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
