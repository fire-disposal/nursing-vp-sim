import { Alert, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconActivity, IconAlertTriangle, IconCircleCheck, IconClock, IconCpu, IconRefresh, IconServer } from "@tabler/icons-react";
import { useState } from "react";
import { type DiagnoseResponse, fetchDiagnose } from "@/api/admin/ops";
import { queryKeys } from "@/api/query-keys";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

function StatGrid({ data }: { data: DiagnoseResponse }) {
	const successRate = data.llm?.success_rate ?? 100;
	const rateColor =
		successRate >= 95 ? "green" : successRate >= 90 ? "amber" : "red";
	const activeSessions = (data.metrics as Record<string, unknown>)?.active_sessions as number ?? 0;
	const scoringSuccessRate = data.scoring?.success_rate ?? 100;
	const scoringColor =
		scoringSuccessRate >= 90 ? "green" : scoringSuccessRate >= 80 ? "amber" : "red";

	return (
		<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
			<StatCard
				icon={IconActivity}
				value={data.health?.status === "ok" ? "正常" : (data.health?.status ?? "未知")}
				label="运行状态"
				color="green"
			/>
			<StatCard
				icon={IconCpu}
				value={`${successRate}%`}
				label="LLM 成功率 (24h)"
				color={rateColor}
			/>
			<StatCard
				icon={IconClock}
				value={`${scoringSuccessRate}%`}
				label="评分成功率 (24h)"
				color={scoringColor}
			/>
			<StatCard
				icon={IconServer}
				value={activeSessions}
				label="活跃会话"
				color="teal"
			/>
		</SimpleGrid>
	);
}

function LLMDetailCard({ data }: { data: DiagnoseResponse }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>LLM 调用 (近 24h)</CardTitle>
			</CardHeader>
			<CardContent>
				<SimpleGrid cols={2} spacing="sm">
					<Text size="sm" c="dimmed">总调用</Text>
					<Text size="sm" ta="right" fw={500} style={{ fontVariantNumeric: "tabular-nums" }}>
						{data.llm?.total_calls_24h?.toLocaleString() ?? 0}
					</Text>
					<Text size="sm" c="dimmed">成功</Text>
					<Text size="sm" ta="right" c="green" style={{ fontVariantNumeric: "tabular-nums" }}>
						{Math.round((data.llm?.total_calls_24h ?? 0) * (data.llm?.success_rate ?? 100) / 100)}
					</Text>
					<Text size="sm" c="dimmed">失败</Text>
					<Text size="sm" ta="right" c="red" style={{ fontVariantNumeric: "tabular-nums" }}>
						{data.llm?.error_count_24h ?? 0}
					</Text>
					<Text size="sm" c="dimmed">平均延迟</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						{data.llm?.avg_latency_ms ?? 0} ms
					</Text>
				</SimpleGrid>
				{(data.llm?.recent_errors?.length ?? 0) > 0 && (
					<Stack gap={4} mt="sm" pt="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
						<Text size="xs" c="dimmed" mb={4}>Top 错误类型</Text>
						{(data.llm?.recent_errors ?? []).map((e) => (
							<Group key={e.type} justify="space-between" gap={8}>
								<Text size="xs" c="dimmed" ff="monospace">
									{e.type || "unknown"}
								</Text>
								<Text size="xs" style={{ fontVariantNumeric: "tabular-nums" }}>{e.count}</Text>
							</Group>
						))}
					</Stack>
				)}
			</CardContent>
		</Card>
	);
}

function ScoringSessionsCard({ data }: { data: DiagnoseResponse }) {
	const uptimeSeconds = Number((data.metrics as Record<string, unknown>)?.uptime_seconds ?? 0);
	const uptimeHours = (uptimeSeconds / 3600).toFixed(1);
	const activeSessions = String((data.metrics as Record<string, unknown>)?.active_sessions ?? 0);

	return (
		<Card>
			<CardHeader>
				<CardTitle>评分 & 会话</CardTitle>
			</CardHeader>
			<CardContent>
				<SimpleGrid cols={2} spacing="sm">
					<Text size="sm" c="dimmed">评分成功率</Text>
					<Text
						size="sm"
						ta="right"
						fw={500}
						c={(data.scoring?.success_rate ?? 100) >= 90 ? "green" : "yellow"}
						style={{ fontVariantNumeric: "tabular-nums" }}
					>
						{data.scoring?.success_rate ?? 100}%
					</Text>
					<Text size="sm" c="dimmed">已完成 (24h)</Text>
					<Text size="sm" ta="right" c="green" style={{ fontVariantNumeric: "tabular-nums" }}>
						{data.scoring?.completed_24h ?? 0}
					</Text>
					<Text size="sm" c="dimmed">失败 (24h)</Text>
					<Text size="sm" ta="right" c="red" style={{ fontVariantNumeric: "tabular-nums" }}>
						{data.scoring?.failed_24h ?? 0}
					</Text>
					<Text size="sm" c="dimmed">待处理</Text>
					<Text size="sm" ta="right" fw={500} style={{ fontVariantNumeric: "tabular-nums" }}>
						{data.scoring?.pending ?? 0}
					</Text>
					<Text size="sm" c="dimmed">进行中</Text>
					<Text size="sm" ta="right" c="blue" style={{ fontVariantNumeric: "tabular-nums" }}>
						{data.scoring?.in_progress ?? 0}
					</Text>
					<Text size="sm" c="dimmed">活跃会话</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						{activeSessions}
					</Text>
					<Text size="sm" c="dimmed">运行时长</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						{uptimeHours} h
					</Text>
					<Text size="sm" c="dimmed">版本</Text>
					<Text size="xs" ta="right" ff="monospace">
						{data.health?.version ?? "-"}
					</Text>
				</SimpleGrid>
			</CardContent>
		</Card>
	);
}

function AlertsCard({ data }: { data: DiagnoseResponse }) {
	const alerts = data.alerts || [];
	return (
		<Alert
			variant="light"
			color={alerts.length > 0 ? "yellow" : "green"}
			icon={alerts.length > 0 ? <IconAlertTriangle size={16} /> : <IconCircleCheck size={16} />}
			title="告警"
		>
			{alerts.length === 0 ? (
				<Text size="sm">系统运行正常，无告警</Text>
			) : (
				<Stack gap={4}>
					{alerts.map((a, i) => (
						<Text key={i} size="sm">{a}</Text>
					))}
				</Stack>
			)}
		</Alert>
	);
}

function HttpFrontendCard({ data }: { data: DiagnoseResponse }) {
	const requests = data.metrics?.requests;
	const frontend = data.frontend_errors;
	const top4xx = requests?.top_4xx ?? [];
	return (
		<Card>
			<CardHeader>
				<CardTitle>HTTP & 前端遥测</CardTitle>
			</CardHeader>
			<CardContent>
				<SimpleGrid cols={2} spacing="sm">
					<Text size="sm" c="dimmed">请求总数</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>{requests?.total ?? 0}</Text>
					<Text size="sm" c="dimmed">4xx</Text>
					<Text size="sm" ta="right" c="yellow" style={{ fontVariantNumeric: "tabular-nums" }}>{requests?.by_status?.["4xx"] ?? 0}</Text>
					<Text size="sm" c="dimmed">p95</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>{requests?.latency_ms?.p95 ?? 0} ms</Text>
					<Text size="sm" c="dimmed">前端错误 5min / 1h</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						{frontend?.last_5min ?? 0} / {frontend?.last_hour ?? 0}
					</Text>
				</SimpleGrid>
				{top4xx.length > 0 && (
					<Stack gap={4} mt="sm" pt="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
						<Text size="xs" c="dimmed" mb={4}>Top 4xx</Text>
						{top4xx.slice(0, 5).map((item) => (
							<Group key={`${item.route}-${item.status}`} justify="space-between" gap={12} wrap="nowrap">
								<Text size="xs" c="dimmed" ff="monospace" truncate style={{ flex: 1 }}>{item.route}</Text>
								<Text size="xs" style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{item.status} · {item.count}</Text>
							</Group>
						))}
					</Stack>
				)}
			</CardContent>
		</Card>
	);
}

function ErrorLogTable({ data }: { data: DiagnoseResponse }) {
	const entries = data.errors?.recent || [];
	return (
		<Card>
			<CardHeader>
				<Group justify="space-between" align="center" wrap="wrap">
					<CardTitle>最近系统错误</CardTitle>
					<Text size="xs" c="dimmed">
						5min: {data.errors?.count?.last_5min ?? 0} · 1h: {data.errors?.count?.last_hour ?? 0} · 24h 类型: {data.errors?.count?.unique_24h ?? 0} · 总计: {data.errors?.count?.total_captured ?? 0}
					</Text>
				</Group>
			</CardHeader>
			<CardContent>
				{entries.length === 0 ? (
					<Text size="sm" c="dimmed" ta="center" py="md">暂无错误</Text>
				) : (
					<div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead style={{ width: 144 }}>时间</TableHead>
									<TableHead>来源</TableHead>
									<TableHead>消息</TableHead>
									<TableHead style={{ width: 96 }}>级别</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{entries.map((e, i) => (
									<TableRow key={i}>
										<TableCell style={{ fontSize: 12, fontFamily: "var(--mantine-font-family-monospace)", whiteSpace: "nowrap" }}>
											{e.time?.slice(0, 19) ?? "-"}
										</TableCell>
										<TableCell style={{ fontSize: 12, fontFamily: "var(--mantine-font-family-monospace)" }}>
											{e.logger ?? "-"}
										</TableCell>
										<TableCell style={{ fontSize: 12, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
											{e.message ?? "-"}
										</TableCell>
										<TableCell style={{ fontSize: 12, fontFamily: "var(--mantine-font-family-monospace)", color: "var(--mantine-color-dimmed)" }}>
											{e.level ?? "-"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export default function SystemOpsPage() {
	const [autoRefresh, setAutoRefresh] = useState(false);

	const { data, isLoading, refetch } = useQuery({
		queryKey: queryKeys.diagnose,
		queryFn: () => fetchDiagnose().then((r) => r.data),
		staleTime: 15_000,
		refetchInterval: autoRefresh ? 30_000 : false,
	});

	const handleRefresh = () => {
		refetch();
	};

	if (isLoading) return <LoadingSkeleton variant="card" />;
	if (!data) return <Text c="dimmed" ta="center" py={32}>诊断数据不可用</Text>;

	return (
		<Stack gap="xl" mt="md">
			<PageHeader
				title="系统运维"
				subtitle="LLM 状态 · 评分队列 · 错误日志 · 会话统计"
				actions={
					<Group gap={8} align="center">
						<Checkbox
							label="自动刷新"
							checked={autoRefresh}
							onCheckedChange={setAutoRefresh}
						/>
						<Button variant="outline" size="sm" onClick={handleRefresh} leftSection={<IconRefresh size={14} />}>
							刷新
						</Button>
					</Group>
				}
			/>

			<StatGrid data={data} />

			<SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
				<LLMDetailCard data={data} />
				<ScoringSessionsCard data={data} />
				<HttpFrontendCard data={data} />
			</SimpleGrid>

			<AlertsCard data={data} />

			<ErrorLogTable data={data} />
		</Stack>
	);
}
