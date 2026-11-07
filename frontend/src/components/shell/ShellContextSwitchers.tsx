import { Box, Divider, Paper, Stack, Text } from "@mantine/core";
import { useSchoolsQuery } from "@/hooks/useSchools";
import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";
import PersonaSwitcher from "./PersonaSwitcher";
import { SchoolScopeSwitcher } from "./SchoolScopeSwitcher";

/**
 * 「当前语境」二合一：视角 + 院校。
 *
 * 两者正交但回答同一个问题——"我现在以什么身份、在谁的语境里操作"：视角换**功能权限**
 * （哪些入口/能力），院校换**数据作用域**（看哪所学校的数据）。合并成一张卡，避免在两个
 * 控件之间来回找。
 *
 * 只显示"真的有得选"的维度：
 * - 视角：可用视角 > 1；
 * - 院校：可见院校 > 1（只有一所时切换没有意义，退化为只读标签）。
 * 两个维度都没有 → 整块不渲染（不留空壳）。
 */
export default function ShellContextSwitchers() {
	const canManageSchools = useAuthStore((s) => s.permissions.includes("school_manage"));
	const hasMultiPersona = usePersonaStore((s) => s.available.length > 1);
	const { data: schools = [] } = useSchoolsQuery({ enabled: canManageSchools });
	const hasMultiSchool = canManageSchools && schools.length > 1;

	if (!hasMultiPersona && !canManageSchools) return null;

	return (
		<Paper withBorder radius="md" p="xs" mb="sm">
			<Stack gap="xs">
				{hasMultiPersona && (
					<Box>
						<Text size="10px" fw={600} c="dimmed" tt="uppercase" mb={4}>
							当前视角
						</Text>
						<PersonaSwitcher variant="segmented" />
					</Box>
				)}
				{hasMultiPersona && canManageSchools && <Divider />}
				{canManageSchools &&
					(hasMultiSchool ? (
						<Box>
							<Text size="10px" fw={600} c="dimmed" tt="uppercase" mb={4}>
								当前院校
							</Text>
							<SchoolScopeSwitcher width="100%" />
						</Box>
					) : (
						// 只有一所院校：选择器退化为只读标签（仍然告诉用户"现在在谁的语境里"）
						<Box>
							<Text size="10px" fw={600} c="dimmed" tt="uppercase" mb={4}>
								当前院校
							</Text>
							<Text size="sm">{schools[0]?.name ?? "—"}</Text>
						</Box>
					))}
			</Stack>
		</Paper>
	);
}
