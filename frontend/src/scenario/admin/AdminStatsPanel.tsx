import { Group, Loader, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { getAdminScenarioStats } from "@/api/scenario";

const ANCHORS = ["strong", "adequate", "missed"] as const;

const ANCHOR_LABEL: Record<string, string> = {
	strong: "强",
	adequate: "合格",
	missed: "漏",
};

/**
 * 统计：按包汇总（会话数 / 已结算 / 不可逆结局 / **决策点锚点分布**）。
 *
 * 只报三类锚点各几条，不做加权总分——本轨不启用能力等第（见 `ScenarioReportView` 的同一约定）。
 */
export default function AdminStatsPanel() {
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

	const packs = statsQuery.data?.packs ?? [];

	if (packs.length === 0) {
		return (
			<Text size="sm" c="dimmed">
				还没有任何情境会话，所以没有可汇总的数据。
			</Text>
		);
	}

	return (
		<Stack gap="md">
			<Table.ScrollContainer minWidth={720}>
				<Table highlightOnHover verticalSpacing="sm">
					<Table.Thead>
						<Table.Tr>
							<Table.Th>情境包</Table.Th>
							<Table.Th>会话</Table.Th>
							<Table.Th>已结算</Table.Th>
							<Table.Th>不可逆结局</Table.Th>
							{ANCHORS.map((anchor) => (
								<Table.Th key={anchor}>{ANCHOR_LABEL[anchor]}锚点</Table.Th>
							))}
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
								{ANCHORS.map((anchor) => (
									<Table.Td key={anchor}>
										{pack.anchors[anchor]}
									</Table.Td>
								))}
							</Table.Tr>
						))}
					</Table.Tbody>
				</Table>
			</Table.ScrollContainer>
			<Text size="xs" c="dimmed">
				锚点分布统计的是所有会话里各决策点的判读结果之和；一个决策点一次结算记一条。
			</Text>
		</Stack>
	);
}
