import { Group, Loader, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { getAdminScenarioStats } from "@/api/scenario";

/**
 * 关注点处理比 → 百分比读数。`null` = 这个病例没有相关关注点可算（**不是 0**），写成「—」；
 * 不把"没有分母"当成"一个都没处理"。
 */
function ratioText(ratio: number | null | undefined): string {
	if (ratio == null) return "—";
	return `${Math.round(ratio * 1000) / 10}%`;
}

/**
 * 统计：按病例汇总（会话数 / 已结算 / 不可逆结局 / **关注点处理比**）。
 *
 * 只报这一个比值，不做加权总分——本轨不启用能力等第（见 `ScenarioReportView` 的同一约定）：
 * `focus_address_ratio` = 已处理的关注点 / 相关关注点，是"本包看到了多少处理证据"，
 * 不是学生能力评分。
 *
 * `packKey` 非空 = 只看**这一个病例**（病例工作区的「统计」块）；空 = 全部病例的汇总
 * （跨病例区）。取的是同一份全局汇总，只是在这里收窄——不为"看一个病例"再要一个接口。
 */
export default function AdminStatsPanel({ packKey = null }: { packKey?: string | null } = {}) {
	const statsQuery = useQuery({
		queryKey: queryKeys.scenario.admin.stats(),
		queryFn: getAdminScenarioStats,
	});

	if (statsQuery.isLoading) {
		return (
			<Group justify="center" py="xl">
				<Loader size="sm" />
			</Group>
		);
	}

	if (statsQuery.isError) {
		return (
			<Text size="sm" c="red">
				统计读取失败：请确认有「数据查看」权限，或稍后重试。
			</Text>
		);
	}

	const all = statsQuery.data?.packs ?? [];
	const packs =
		packKey === null ? all : all.filter((bucket) => bucket.pack_key === packKey);

	if (packs.length === 0) {
		return (
			<Text size="sm" c="dimmed">
				{packKey === null
					? "还没有任何情境会话，所以没有可汇总的数据。"
					: "这个病例还没有会话，所以没有可汇总的数据。"}
			</Text>
		);
	}

	return (
		<Stack gap="md">
			<Table.ScrollContainer minWidth={720}>
				<Table highlightOnHover verticalSpacing="sm">
					<Table.Thead>
						<Table.Tr>
							<Table.Th>病例</Table.Th>
							<Table.Th>会话</Table.Th>
							<Table.Th>已结算</Table.Th>
							<Table.Th>不可逆结局</Table.Th>
							<Table.Th>关注点处理比</Table.Th>
						</Table.Tr>
					</Table.Thead>
					<Table.Tbody>
						{packs.map((pack) => (
							<Table.Tr key={pack.pack_key}>
								<Table.Td>
									<Text fw={600}>{pack.pack_title}</Text>
									<Text size="xs" c="dimmed">
										{pack.pack_key}
									</Text>
								</Table.Td>
								<Table.Td>{pack.sessions}</Table.Td>
								<Table.Td>{pack.completed}</Table.Td>
								<Table.Td>{pack.lost}</Table.Td>
								<Table.Td>{ratioText(pack.focus_address_ratio)}</Table.Td>
							</Table.Tr>
						))}
					</Table.Tbody>
				</Table>
			</Table.ScrollContainer>
			<Text size="xs" c="dimmed">
				关注点处理比 = 所有会话里「已处理」的教学关注点 / 「相关」的教学关注点之和；
				没有关注点的病例写「—」（没有分母，不是 0）。它是本包观察到的处理证据，不是能力等第。
			</Text>
		</Stack>
	);
}
