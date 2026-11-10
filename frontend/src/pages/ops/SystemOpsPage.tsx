import { Alert, Anchor, Button, Checkbox, Group, Progress, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { IconActivity, IconAlertTriangle, IconCircleCheck, IconClock, IconCpu, IconRefresh, IconServer } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
	type DiagnoseResponse,
	fetchDiagnose,
	resolveBackendGroups,
	resolveFrontendGroups,
} from "@/api/admin/ops";
import { queryKeys } from "@/api/query-keys";
import TableScroll from "@/components/ui/table-scroll";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";
import { formatShortDateTime } from "@/utils/date";

function StatGrid({ data }: { data: DiagnoseResponse }) {
	const successRate = data.llm?.success_rate ?? 100;
	const rateColor =
		successRate >= 95 ? "green" : successRate >= 90 ? "amber" : "red";
	const activeSessions = data.metrics?.active_sessions ?? 0;
	const degraded = (data.alerts?.length ?? 0) > 0;
	const scoringSuccessRate = data.scoring?.success_rate ?? 100;
	const scoringColor =
		scoringSuccessRate >= 90 ? "green" : scoringSuccessRate >= 80 ? "amber" : "red";

	return (
		<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
			<StatCard
				icon={IconActivity}
				value={degraded ? "降级" : "正常"}
				label="运行状态 (alerts)"
				color={degraded ? "red" : "green"}
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
				label="进行中训练"
				color="blue"
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
				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
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
	const uptimeSeconds = Number(data.metrics?.uptime_seconds ?? 0);
	const uptimeHours = (uptimeSeconds / 3600).toFixed(1);
	const activeSessions = String(data.metrics?.active_sessions ?? 0);

	return (
		<Card>
			<CardHeader>
				<CardTitle>评分 & 会话</CardTitle>
			</CardHeader>
			<CardContent>
				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
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
						{data.metrics?.version ?? "-"}
					</Text>
				</SimpleGrid>
			</CardContent>
		</Card>
	);
}

function JobsCard({ data }: { data: DiagnoseResponse }) {
	const jobs = data.jobs;
	const kinds = Object.entries(jobs?.by_kind ?? {});
	const oldest = jobs?.oldest_pending_seconds ?? 0;
	const expired = jobs?.expired_leases ?? 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle>作业队列 (jobs)</CardTitle>
			</CardHeader>
			<CardContent>
				{jobs == null ? (
					<Text size="sm" c="dimmed">该版本未提供作业块</Text>
				) : (
					<Stack gap="xs">
						{kinds.length === 0 ? (
							<Text size="sm" c="dimmed">暂无作业记录</Text>
						) : (
							kinds.map(([kind, statuses]) => (
								<Group key={kind} justify="space-between" gap="xs">
									<Text size="sm" ff="monospace">{kind}</Text>
									<Group gap="sm">
										<Text size="sm" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
											pending {statuses.pending ?? 0}
										</Text>
										<Text size="sm" c="blue" style={{ fontVariantNumeric: "tabular-nums" }}>
											running {statuses.running ?? 0}
										</Text>
										<Text
											size="sm"
											c={(statuses.failed ?? 0) > 0 ? "red" : "dimmed"}
											style={{ fontVariantNumeric: "tabular-nums" }}
										>
											failed {statuses.failed ?? 0}
										</Text>
									</Group>
								</Group>
							))
						)}
						<Group justify="space-between">
							<Text size="sm" c="dimmed">最老 pending 等待</Text>
							<Text size="sm" fw={500} c={oldest > 300 ? "yellow" : "dimmed"} style={{ fontVariantNumeric: "tabular-nums" }}>
								{oldest} s
							</Text>
						</Group>
						<Group justify="space-between">
							<Text size="sm" c="dimmed">过期租约</Text>
							<Text size="sm" fw={500} c={expired > 0 ? "red" : "green"} style={{ fontVariantNumeric: "tabular-nums" }}>
								{expired}
							</Text>
						</Group>
					</Stack>
				)}
			</CardContent>
		</Card>
	);
}

function VoiceBudgetCard({ data }: { data: DiagnoseResponse }) {
	const tts = data.voice?.tts;
	const successRate = tts?.success_rate ?? 0;
	const rateColor = successRate >= 95 ? "green" : successRate >= 90 ? "amber" : "red";
	const budget = data.voice_budget ?? { monthly_budget: 0, monthly_cost: 0, usage_pct: 0 };
	const usagePct = budget.usage_pct ?? 0;
	// 月用量 >=80% 进入警示区（>=90% 红），未设预算时 usage_pct 恒为 0。
	const usageColor = usagePct >= 90 ? "red" : usagePct >= 80 ? "amber" : "green";

	return (
		<Card>
			<CardHeader>
				<CardTitle>语音与预算</CardTitle>
			</CardHeader>
			<CardContent>
				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
					<Text size="sm" c="dimmed">TTS 调用 (24h)</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						{(tts?.calls_24h ?? 0).toLocaleString()}
					</Text>
					<Text size="sm" c="dimmed">成功率</Text>
					<Text
						size="sm"
						ta="right"
						fw={500}
						c={rateColor}
						style={{ fontVariantNumeric: "tabular-nums" }}
					>
						{successRate}%
					</Text>
					<Text size="sm" c="dimmed">失败</Text>
					<Text size="sm" ta="right" c="red" style={{ fontVariantNumeric: "tabular-nums" }}>
						{tts?.error_count_24h ?? 0}
					</Text>
					<Text size="sm" c="dimmed">平均延迟</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						{tts?.avg_latency_ms ?? 0} ms
					</Text>
					<Text size="sm" c="dimmed">成本 (24h)</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						¥{(tts?.cost_24h ?? 0).toFixed(4)}
					</Text>
				</SimpleGrid>
				<Stack
					gap={6}
					mt="sm"
					pt="sm"
					style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
				>
					<Group justify="space-between" gap={8}>
						<Text size="sm" c="dimmed">月用量 (北京自然月)</Text>
						<Text
							size="sm"
							fw={500}
							c={usageColor}
							style={{ fontVariantNumeric: "tabular-nums" }}
						>
							{usagePct}%
						</Text>
					</Group>
					<Progress value={Math.min(Math.max(usagePct, 0), 100)} color={usageColor} size="sm" />
					<Text size="xs" c="dimmed" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						¥{(budget.monthly_cost ?? 0).toFixed(4)} / ¥{(budget.monthly_budget ?? 0).toFixed(2)}
					</Text>
				</Stack>
			</CardContent>
		</Card>
	);
}

function BusinessCard({ data }: { data: DiagnoseResponse }) {
	const business = data.business;
	const feedback = data.feedback;
	const unanswered = feedback?.unanswered ?? 0;
	const ageDays = feedback?.oldest_age_days ?? null;
	const feedbackColor = unanswered === 0 ? "green" : unanswered >= 5 ? "red" : "amber";

	return (
		<Card>
			<CardHeader>
				<CardTitle>业务量 (今日 · 北京)</CardTitle>
			</CardHeader>
			<CardContent>
				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
					<Text size="sm" c="dimmed">今日用户</Text>
					<Text size="sm" ta="right" fw={500} style={{ fontVariantNumeric: "tabular-nums" }}>
						{(business?.today_users ?? 0).toLocaleString()}
					</Text>
					<Text size="sm" c="dimmed">今日训练</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						{(business?.today_trainings ?? 0).toLocaleString()}
					</Text>
					<Text size="sm" c="dimmed">今日完成</Text>
					<Text size="sm" ta="right" c="green" style={{ fontVariantNumeric: "tabular-nums" }}>
						{(business?.today_completed ?? 0).toLocaleString()}
					</Text>
				</SimpleGrid>
				<Stack
					gap={4}
					mt="sm"
					pt="sm"
					style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
				>
					<Group justify="space-between" gap={8}>
						<Text size="sm" c="dimmed">未回复反馈</Text>
						<Text size="sm" fw={500} c={feedbackColor} style={{ fontVariantNumeric: "tabular-nums" }}>
							{unanswered} 条
						</Text>
					</Group>
					{unanswered > 0 && ageDays != null && (
						<Text size="xs" c="dimmed">
							{ageDays >= 1 ? `最老一条 ${ageDays} 天前` : "最老一条不足 1 天"}
						</Text>
					)}
				</Stack>
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
				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
					<Text size="sm" c="dimmed">请求总数</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>{requests?.total ?? 0}</Text>
					<Text size="sm" c="dimmed">4xx</Text>
					<Text size="sm" ta="right" c="yellow" style={{ fontVariantNumeric: "tabular-nums" }}>{requests?.by_status?.["4xx"] ?? 0}</Text>
					<Text size="sm" c="dimmed">p95</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>{requests?.latency_ms?.p95 ?? 0} ms</Text>
					<Text size="sm" c="dimmed">前端错误 5min / 1h</Text>
					<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
						{frontend?.count?.last_5min ?? 0} / {frontend?.count?.last_hour ?? 0}
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

/**
 * 错误组表 —— 后端档案分组，每行「指纹」是到 `/admin/system-ops/errors/:fingerprint` 的真链接。
 *
 * 数据源是 `errors.groups`（后端 `get_error_context()` 的投影）优先，只有 `recent` 行时
 * 由 `resolveBackendGroups` 按指纹聚合（见 api/admin/ops.ts）。没有分组就没有可下钻的证据，
 * 此时如实说明，而不是给一个点进去必然空的链接。
 */
function ErrorGroupTable({ data }: { data: DiagnoseResponse }) {
	const groups = useMemo(() => resolveBackendGroups(data.errors), [data.errors]);
	const windowLabel = data.errors?.window ?? "当前窗口";
	return (
		<Card>
			<CardHeader>
				<Group justify="space-between" align="center" wrap="wrap">
					<CardTitle>最近系统错误</CardTitle>
					<Text size="xs" c="dimmed">
						5min: {data.errors?.count?.last_5min ?? 0} · 1h: {data.errors?.count?.last_hour ?? 0} · 24h 签名: {data.errors?.count?.unique_24h ?? 0}
					</Text>
				</Group>
			</CardHeader>
			<CardContent>
				{groups.length === 0 ? (
					<Text size="sm" c="dimmed" ta="center" py="md">暂无错误</Text>
				) : (
					<TableScroll
						minWidth={720}
						maxHeight={320}
						style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}
					>
						<Table highlightOnHover>
							<Table.Thead>
								<Table.Tr>
									<Table.Th style={{ width: 144 }}>最近时间</Table.Th>
									<Table.Th style={{ width: 96 }}>级别</Table.Th>
									<Table.Th style={{ width: 200 }}>来源</Table.Th>
									<Table.Th>消息</Table.Th>
									<Table.Th style={{ width: 72 }}>次数</Table.Th>
									<Table.Th style={{ width: 150 }}>指纹</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{groups.map((group) => (
									<Table.Tr key={group.fingerprint}>
										<Table.Td style={{ fontSize: 12, fontFamily: "var(--mantine-font-family-monospace)", whiteSpace: "nowrap" }}>
											{formatShortDateTime(group.last_seen) || "-"}
										</Table.Td>
										<Table.Td style={{ fontSize: 12, fontFamily: "var(--mantine-font-family-monospace)", color: "var(--mantine-color-dimmed)" }}>
											{group.level || "-"}
										</Table.Td>
										<Table.Td style={{ fontSize: 12, fontFamily: "var(--mantine-font-family-monospace)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
											{group.logger || "-"}
										</Table.Td>
										<Table.Td style={{ fontSize: 12, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
											{group.message || "-"}
										</Table.Td>
										<Table.Td style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
											{group.count}
										</Table.Td>
										<Table.Td>
											{/* 键盘可用：Anchor + Link 是真 <a>，Tab/Enter 都能走 */}
											<Anchor
												component={Link}
												to={`/admin/system-ops/errors/${encodeURIComponent(group.fingerprint)}`}
												size="xs"
												ff="monospace"
												aria-label={`查看错误组 ${group.fingerprint} 详情`}
											>
												{group.fingerprint}
											</Anchor>
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</TableScroll>
				)}
				<Text size="xs" c="dimmed" mt="sm">
					窗口 {windowLabel}；点击指纹查看该组的首末时间、消息变体与浏览器现场。
					{data.errors?.truncated && (
						<>
							{" "}
							当前窗口共 {data.errors?.unique_groups ?? "?"} 个指纹，本表只列出最近
							{data.errors?.groups?.length ?? 0} 个代表错误（更多见日志档案）。
						</>
					)}
					{data.errors?.groups == null && (
						<> 本快照未透出 `errors.groups`，上表由 `recent` 行按指纹聚合，变体列表可能不完整。</>
					)}
				</Text>
			</CardContent>
		</Card>
	);
}

/**
 * 前端遥测错误组 —— 每行链接到同一详情页（指纹算法不同，由详情页自行辨认来源）。
 */
function FrontendErrorTable({ data }: { data: DiagnoseResponse }) {
	const groups = useMemo(
		() => resolveFrontendGroups(data.frontend_errors),
		[data.frontend_errors],
	);
	if (groups.length === 0) return null;
	return (
		<Card>
			<CardHeader>
				<Group justify="space-between" align="center" wrap="wrap">
					<CardTitle>前端遥测错误组</CardTitle>
					<Text size="xs" c="dimmed">
						窗口 {data.frontend_errors?.window ?? "当前窗口"} · {groups.length} 组
					</Text>
				</Group>
			</CardHeader>
			<CardContent>
				<TableScroll
					minWidth={720}
					maxHeight={320}
					style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}
				>
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th style={{ width: 144 }}>最近时间</Table.Th>
								<Table.Th style={{ width: 140 }}>类型</Table.Th>
								<Table.Th>消息</Table.Th>
								<Table.Th style={{ width: 180 }}>URL</Table.Th>
								<Table.Th style={{ width: 72 }}>次数</Table.Th>
								<Table.Th style={{ width: 150 }}>指纹</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{groups.map((group) => (
								<Table.Tr key={group.fingerprint}>
									<Table.Td style={{ fontSize: 12, fontFamily: "var(--mantine-font-family-monospace)", whiteSpace: "nowrap" }}>
										{formatShortDateTime(group.time) || "-"}
									</Table.Td>
									<Table.Td style={{ fontSize: 12, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
										{group.type || "-"}
									</Table.Td>
									<Table.Td style={{ fontSize: 12, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
										{group.message || "-"}
									</Table.Td>
									<Table.Td style={{ fontSize: 12, fontFamily: "var(--mantine-font-family-monospace)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
										{group.url || "-"}
									</Table.Td>
									<Table.Td style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
										{group.count}
									</Table.Td>
									<Table.Td>
										<Anchor
											component={Link}
											to={`/admin/system-ops/errors/${encodeURIComponent(group.fingerprint)}`}
											size="xs"
											ff="monospace"
											aria-label={`查看前端错误组 ${group.fingerprint} 详情`}
										>
											{group.fingerprint}
										</Anchor>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</TableScroll>
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
				subtitle="LLM 状态 · 评分队列 · 作业队列 · 语音预算 · 业务量 · 错误日志 · 会话统计"
				actions={
					<Group gap={8} align="center">
						<Checkbox
							label="自动刷新"
							checked={autoRefresh}
							onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
						/>
						<Button variant="outline" size="sm" onClick={handleRefresh} leftSection={<IconRefresh size={14} />}>
							刷新
						</Button>
					</Group>
				}
			/>

			<StatGrid data={data} />

			<SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" style={{ alignItems: "start" }}>
				<LLMDetailCard data={data} />
				<ScoringSessionsCard data={data} />
				<VoiceBudgetCard data={data} />
				<JobsCard data={data} />
				<BusinessCard data={data} />
				<HttpFrontendCard data={data} />
			</SimpleGrid>

			<AlertsCard data={data} />

			<ErrorGroupTable data={data} />
			<FrontendErrorTable data={data} />
		</Stack>
	);
}
