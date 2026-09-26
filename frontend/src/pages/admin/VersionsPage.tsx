import { APP_TIME_ZONE } from "@/utils/date";
import { Badge, Group, Paper, SegmentedControl, Select, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
	type AttributionDimension,
	getVersionAttribution,
} from "@/api/admin/versions";
import { queryKeys } from "@/api/query-keys";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";

/**
 * 版本归因（只读）—— 回答「哪一版提示词/评分标准/映射曲线产出的分更好」。
 *
 * 身份从**既有数据**派生：提示词取训练记录冻结的 `prompt_snapshot`（现算 hash），
 * rubric / 映射取分数行上的既有字段。`unknown` = 该维度上身份不可知（历史记录），
 * 页面不做任何回填或推测（docs/ideas/prompt-context-versioning.md §四）。
 */

const DIMENSION_LABELS: Record<AttributionDimension, string> = {
	prompt: "提示词",
	rubric: "评分标准",
	mapping: "分数映射",
	context: "上下文策略",
};

const WINDOWS = [
	{ value: "30", label: "近 30 天" },
	{ value: "90", label: "近 90 天" },
	{ value: "180", label: "近 180 天" },
	{ value: "365", label: "近一年" },
];

function formatDate(iso: string | null): string {
	if (!iso) return "—";
	return new Date(iso).toLocaleDateString("zh-CN", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function VersionsPage() {
	const [by, setBy] = useState<AttributionDimension>("prompt");
	const [windowDays, setWindowDays] = useState("90");

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.versions.attribution(by, Number(windowDays)),
		queryFn: () => getVersionAttribution({ by, window_days: Number(windowDays) }).then((r) => r.data),
		staleTime: 60_000,
	});

	const items = useMemo(() => data?.items ?? [], [data]);

	return (
		<Stack gap="md">
			<PageHeader
				title="提示词与版本归因"
				subtitle="按内容身份聚合训练效果：改了提示词之后，分数是升了还是降了"
			/>

			<Paper withBorder p="md">
				<Group justify="space-between" wrap="wrap">
					<SegmentedControl
						value={by}
						onChange={(value) => setBy(value as AttributionDimension)}
						data={(Object.keys(DIMENSION_LABELS) as AttributionDimension[]).map((key) => ({
							value: key,
							label: DIMENSION_LABELS[key],
						}))}
					/>
					<Group gap="sm">
						{data ? (
							<Text size="sm" c="dimmed">
								{data.totals.identities} 个身份 · {data.totals.records} 条记录
								{data.truncated ? "（已截断）" : ""}
							</Text>
						) : null}
						<Select
							value={windowDays}
							onChange={(value) => setWindowDays(value ?? "90")}
							data={WINDOWS}
							w={120}
							allowDeselect={false}
						/>
					</Group>
				</Group>
			</Paper>

			{isLoading ? (
				<LoadingSkeleton variant="card" />
			) : items.length === 0 ? (
				<EmptyState title="该窗口内没有记录" description="换一个时间窗口，或等训练产生数据后再看。" />
			) : (
				<Paper withBorder>
					<Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>身份</Table.Th>
								<Table.Th>记录</Table.Th>
								<Table.Th>已评分</Table.Th>
								<Table.Th>平均分</Table.Th>
								<Table.Th>兜底率</Table.Th>
								<Table.Th>首次出现</Table.Th>
								<Table.Th>最近出现</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{items.map((row) => (
								<Table.Tr key={row.identity}>
									<Table.Td>
										<Text size="sm" ff="monospace">
											{row.identity}
										</Text>
									</Table.Td>
									<Table.Td>{row.records}</Table.Td>
									<Table.Td>{row.scored}</Table.Td>
									<Table.Td>
										{row.avg_score === null ? (
											<Text size="sm" c="dimmed">
												无成绩
											</Text>
										) : (
											<Badge variant="light" color={row.avg_score >= 85 ? "green" : row.avg_score >= 60 ? "yellow" : "red"}>
												{row.avg_score}
											</Badge>
										)}
									</Table.Td>
									<Table.Td>
										{row.fallback_rate === null ? (
											<Text size="sm" c="dimmed">
												—
											</Text>
										) : (
											<Text size="sm">{Math.round(row.fallback_rate * 100)}%</Text>
										)}
									</Table.Td>
									<Table.Td>{formatDate(row.first_seen)}</Table.Td>
									<Table.Td>{formatDate(row.last_seen)}</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Paper>
			)}

			<Text size="xs" c="dimmed">
				身份 = 产物原文的 sha256 前 12 位（提示词为 <code>{"{workflow}@{hash}"}</code>）。
				提示词身份按需派生（不落库）；评分标准与分数映射取自分数行既有字段；
				上下文策略取自记录创建时冻结的 <code>context_policy_version</code>。
				<code>unknown</code> 表示该维度上记录不可追溯（历史记录早于相应字段），不做回填。
			</Text>
		</Stack>
	);
}
