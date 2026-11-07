import { Box, Divider, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { useSchoolsQuery } from "@/hooks/useSchools";
import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";
import { personaLabel } from "@/utils/personas";
import PersonaSwitcher from "./PersonaSwitcher";
import { SchoolScopeSwitcher } from "./SchoolScopeSwitcher";

/**
 * 「当前语境」二合一：院校 + 视角。
 *
 * - 院校 = 数据作用域（看哪所学校的数据）；视角 = 功能权限（能做哪些事）。
 * - **可切换者可选择，不可切换者锁定**：两个字段始终显示，避免"控件时有时无"；
 *   没有第二个选项时退化为带锁的只读值（并说明为什么锁定），而不是把字段藏起来。
 * - 顺序：院校（外）→ 视角（内）。
 */

function LockedValue({ value, hint }: { value: string; hint: string }) {
	return (
		<Tooltip label={hint} withArrow>
			<Group gap={6} wrap="nowrap" style={{ cursor: "default" }}>
				<IconLock size={12} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
				<Text size="sm" c="dimmed" truncate>
					{value}
				</Text>
			</Group>
		</Tooltip>
	);
}

export default function ShellContextSwitchers() {
	const permissions = useAuthStore((s) => s.permissions);
	const user = useAuthStore((s) => s.user);
	const canManageSchools = permissions.includes("school_manage");
	const available = usePersonaStore((s) => s.available);
	const activePersona = usePersonaStore((s) => s.active);
	const { data: schools = [] } = useSchoolsQuery({ enabled: canManageSchools });

	const hasMultiPersona = available.length > 1;
	const hasMultiSchool = canManageSchools && schools.length > 1;

	// 院校锁定值：院校角色用自己的院校；平台角色只有一所时显示那一所
	const lockedSchool = canManageSchools ? (schools[0]?.name ?? "—") : (user?.school_name ?? "—");
	const schoolHint = canManageSchools
		? "当前只有一所院校，无需切换"
		: "账号固定在本院校（院校边界不可切换）";
	const personaHint = available.length <= 1 ? "账号只有这一个视角" : "当前视角";

	return (
		<Paper withBorder radius="md" p="xs" mb="sm">
			<Stack gap="xs">
				<Box>
					<Text size="10px" fw={600} c="dimmed" tt="uppercase" mb={4}>
						当前院校
					</Text>
					{hasMultiSchool ? (
						<SchoolScopeSwitcher width="100%" />
					) : (
						<LockedValue value={lockedSchool} hint={schoolHint} />
					)}
				</Box>

				<Divider />

				<Box>
					<Text size="10px" fw={600} c="dimmed" tt="uppercase" mb={4}>
						当前视角
					</Text>
					{hasMultiPersona ? (
						<PersonaSwitcher variant="segmented" />
					) : (
						<LockedValue value={personaLabel(activePersona) ?? "—"} hint={personaHint} />
					)}
				</Box>
			</Stack>
		</Paper>
	);
}
