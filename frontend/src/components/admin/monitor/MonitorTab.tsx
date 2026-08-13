import { useMutation, useQuery } from "@tanstack/react-query";
import {
	IconActivity,
	IconAlertCircle,
	IconBolt,
	IconChartBar,
	IconDownload,
	IconServer,
	IconTrendingUp,
} from "@tabler/icons-react";
import {
	Alert,
	Box,
	Grid,
	Group,
	Paper,
	ScrollArea,
	Select,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { exportLLMLogs, getLLMLogs, getLLMStats } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import CallLogTimeline from "./CallLogTimeline";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { LLM_PURPOSE_LABELS } from "@/config/llm-purposes";

type Schemas = components["schemas"];
type LLMCallLogItem = Schemas["LLMCallLogItem"];

const PURPOSE_LABELS = LLM_PURPOSE_LABELS;

function safeDate(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString("zh-CN");
}

function purposeLabel(item: LLMCallLogItem): string {
	if (item.is_aggregated && item.purpose === "patient_chat") {
		return `训练对话（${item.call_count}轮）`;
	}
	return PURPOSE_LABELS[item.purpose] || item.purpose;
}

interface LLMStats {
	today: {
		count: number;
		success_rate: number;
		avg_latency_ms: number;
		total_cost: number;
	};
	week: { count: number; success_rate: number; avg_latency_ms: number };
	month?: { count: number; total_cost: number };
	by_provider: {
		provider: string;
		count: number;
		total_cost: number;
		error_count: number;
	}[];
	by_purpose: {
		purpose: string;
		count: number;
		avg_latency_ms: number;
		error_count: number;
	}[];
	daily: {
		date: string;
		count: number;
		fail_count: number;
		total_cost?: number;
	}[];
}

export default function MonitorTab() {
	const [offset, setOffset] = useState(0);
	const LIMIT = 20;

	const [searchParams, setSearchParams] = useSearchParams();
	const purpose = searchParams.get("purpose") || "";
	const status = searchParams.get("status") || "";
	const dateFrom = searchParams.get("date_from") || "";
	const dateTo = searchParams.get("date_to") || "";

	const updateParam = useCallback(
		(key: string, value: string) => {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				if (value) next.set(key, value);
				else next.delete(key);
				return next;
			});
			setOffset(0);
		},
		[setSearchParams],
	);

	const filters = { purpose, status, date_from: dateFrom, date_to: dateTo };

	const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);

	const {
		data: stats,
		isLoading: statsLoading,
		isError: statsError,
		refetch: refetchStats,
	} = useQuery({
		queryKey: queryKeys.admin.llm.stats(),
		queryFn: () => getLLMStats().then((r) => r.data as LLMStats),
	});

	const logParams: Record<string, unknown> = { offset, limit: LIMIT };
	if (filters.purpose) logParams.purpose = filters.purpose;
	if (filters.status) logParams.status = filters.status;
	if (filters.date_from) logParams.date_from = filters.date_from;
	if (filters.date_to) logParams.date_to = filters.date_to;

	const { data: logData, isLoading } = useQuery({
		queryKey: queryKeys.admin.llm.logs({ offset, ...filters }),
		queryFn: () => getLLMLogs(logParams).then((r) => r.data),
	});
	const logs = logData?.items ?? [];
	const logTotal = logData?.total ?? 0;

	const exportMutation = useMutation({
		mutationFn: () =>
			exportLLMLogs(
				filters.date_from || undefined,
				filters.date_to || undefined,
			),
		onSuccess: (resp) => {
			const blob = new Blob([resp.data as BlobPart], { type: "text/csv" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "llm_logs_export.csv";
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 100);
		},
	});

	if (statsLoading) {
		return (
			<Paper withBorder radius="lg" p="xl" ta="center">
				<Stack align="center" gap="xs">
					<IconActivity size={36} style={{ color: "var(--mantine-color-dimmed)" }} />
					<Text c="dimmed">正在加载监控数据...</Text>
				</Stack>
			</Paper>
		);
	}

	if (statsError) {
		return (
			<Alert
				color="red"
				icon={<IconAlertCircle size={18} />}
				title="监控数据加载失败"
			>
				<Button size="xs" onClick={() => refetchStats()}>
					重试
				</Button>
			</Alert>
		);
	}

	if (!stats) {
		return null;
	}

	const statCards = [
		{
			label: "调用次数",
			value: String(stats.today.count),
			sub: `${stats.week.count} (7日) · ${stats.month?.count ?? 0} (本月)`,
			color: "blue",
		},
		{
			label: "成功率",
			value: `${stats.today.success_rate}%`,
			sub: `${stats.week.success_rate}% (7日)`,
			color: stats.today.success_rate >= 95 ? "green" : "amber",
		},
		{
			label: "平均延迟",
			value: `${stats.today.avg_latency_ms}ms`,
			sub: `${stats.week.avg_latency_ms}ms (7日)`,
			color: "blue",
		},
		{
			label: "预估费用",
			value: `¥${stats.today.total_cost.toFixed(4)}`,
			sub: `¥${(stats.month?.total_cost ?? 0).toFixed(2)} (本月)`,
			color: "amber",
		},
	];

	return (
		<>
			<Stack gap="md" mb="md">
				<Text size="md" fw={600} c="dimmed">
					今日概览
				</Text>
				<SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
					{statCards.map((s, i) => (
						<Paper key={i} withBorder radius="lg" p="md" ta="center">
							<Text size="xs" c="dimmed" mb={6}>
								{s.label}
							</Text>
							<Text
								fw={700}
								size="xl"
								c={
									s.color === "green"
										? "green"
										: s.color === "amber"
											? "yellow"
											: "teal"
								}
							>
								{s.value}
							</Text>
							<Text size="xs" c="dimmed" mt={2}>
								{s.sub}
							</Text>
						</Paper>
					))}
				</SimpleGrid>
			</Stack>

			{stats.by_provider?.length > 0 && (
				<Paper withBorder radius="lg" p="md" mb="md">
					<Group gap={6} mb="md">
						<IconChartBar size={14} />
						<Text size="sm" fw={600} c="dimmed">
							按 Provider 统计 (7日)
						</Text>
					</Group>
					<ScrollArea>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Provider</TableHead>
									<TableHead>次数</TableHead>
									<TableHead>费用</TableHead>
									<TableHead>错误</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{stats.by_provider.map((p) => (
									<TableRow key={p.provider}>
										<TableCell>
											<Text component="span" fw={600}>
												{p.provider}
											</Text>
										</TableCell>
										<TableCell>{p.count}</TableCell>
										<TableCell>
											<Text component="span" c="yellow">
												¥{p.total_cost.toFixed(4)}
											</Text>
										</TableCell>
										<TableCell>
											<Badge variant={p.error_count > 0 ? "danger" : "success"}>
												{p.error_count}
											</Badge>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</ScrollArea>
				</Paper>
			)}

			{stats.daily.length > 0 && (
				<Paper withBorder radius="lg" p="md" mb="md">
					<Group gap={6} mb="md">
						<IconTrendingUp size={16} />
						<Text fw={600} c="dimmed">
							近30天每日调用趋势
						</Text>
					</Group>
					<Group
						align="flex-end"
						gap={4}
						h={120}
						pt="xs"
						wrap="nowrap"
						style={{ alignItems: "flex-end" }}
					>
						{stats.daily.map((d) => {
							const maxCount = Math.max(...stats.daily.map((x) => x.count), 1);
							const h = Math.max(4, (d.count / maxCount) * 100);
							const failRatio = d.count > 0 ? d.fail_count / d.count : 0;
							return (
								<div
									key={d.date}
									style={{
										flex: 1,
										minWidth: 0,
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
									}}
									title={`${d.date}: ${d.count}次 · ¥${(d.total_cost ?? 0).toFixed(4)}`}
								>
									<div
										style={{
											fontSize: "0.55rem",
											color: "var(--mantine-color-dimmed)",
											marginBottom: 2,
										}}
									>
										{d.count || ""}
									</div>
									<div
										style={{
											width: "100%",
											height: `${h}%`,
											borderRadius: "2px 2px 0 0",
											opacity: 0.85,
											minHeight: 2,
											background:
												failRatio > 0.2
													? "var(--mantine-color-red-4)"
													: "var(--mantine-color-blue-4)",
										}}
									/>
									<div
										style={{
											fontSize: "0.55rem",
											color: "var(--mantine-color-dimmed)",
											marginTop: 4,
											transform: "rotate(-45deg)",
											transformOrigin: "top left",
											whiteSpace: "nowrap",
										}}
									>
										{d.date.slice(5)}
									</div>
								</div>
							);
						})}
					</Group>
				</Paper>
			)}

			<Grid mb="md">
				<Grid.Col span={{ base: 12, md: 4 }}>
					<Paper withBorder radius="lg" p="md">
						<Group gap={6} mb="md">
							<IconActivity size={14} />
							<Text size="sm" fw={600} c="dimmed">
								按用途统计 (7日)
							</Text>
						</Group>
						<ScrollArea>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>用途</TableHead>
										<TableHead>次数</TableHead>
										<TableHead>延迟</TableHead>
										<TableHead>错误</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{stats.by_purpose.map((p) => (
										<TableRow key={p.purpose}>
											<TableCell>
												<Badge variant="info">
													{PURPOSE_LABELS[p.purpose] || p.purpose}
												</Badge>
											</TableCell>
											<TableCell>
												<Text component="span" fw={600}>
													{p.count}
												</Text>
											</TableCell>
											<TableCell>
												<Text component="span" c="dimmed">
													{p.avg_latency_ms}ms
												</Text>
											</TableCell>
											<TableCell>
												<Badge variant={p.error_count > 0 ? "danger" : "success"}>
													{p.error_count}
												</Badge>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</ScrollArea>
					</Paper>
				</Grid.Col>

				<Grid.Col span={{ base: 12, md: 8 }}>
					<Paper withBorder radius="lg" p="md">
						<Group gap={6} mb="md">
							<IconServer size={14} />
							<Text size="sm" fw={600} c="dimmed">
								最近训练调用日志
							</Text>
						</Group>
						<Group justify="space-between" mb="md" wrap="wrap" gap="xs">
							<Group gap="xs" wrap="wrap" align="flex-end">
								<Select
									size="xs"
									placeholder="全部用途"
									clearable
									value={filters.purpose || null}
									onChange={(v) => updateParam("purpose", v ?? "")}
									data={Object.entries(PURPOSE_LABELS).map(([k, v]) => ({
										value: k,
										label: v,
									}))}
								/>
								<Select
									size="xs"
									placeholder="全部状态"
									clearable
									value={filters.status || null}
									onChange={(v) => updateParam("status", v ?? "")}
									data={[
										{ value: "success", label: "成功" },
										{ value: "failed", label: "失败" },
										{ value: "timeout", label: "超时" },
									]}
								/>
								<TextInput
									size="xs"
									type="date"
									value={filters.date_from}
									onChange={(e) => updateParam("date_from", e.currentTarget.value)}
								/>
								<TextInput
									size="xs"
									type="date"
									value={filters.date_to}
									onChange={(e) => updateParam("date_to", e.currentTarget.value)}
								/>
							</Group>
							<Button
								variant="outline"
								size="xs"
								leftSection={<IconDownload size={13} />}
								onClick={() => exportMutation.mutate()}
							>
								导出CSV
							</Button>
						</Group>
						{isLoading ? (
							<Text c="dimmed" ta="center" py="lg">
								加载中...
							</Text>
						) : logs.length === 0 ? (
							<EmptyState icon={IconBolt} title="暂无日志记录" />
						) : (
							<>
								<ScrollArea>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>时间</TableHead>
												<TableHead>记录</TableHead>
												<TableHead>用途</TableHead>
												<TableHead>Provider</TableHead>
												<TableHead>状态</TableHead>
												<TableHead>延迟</TableHead>
												<TableHead>Token</TableHead>
												<TableHead>费用</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{logs.map((item) => (
												<TableRow
													key={item.id}
													style={{
														cursor:
															item.record_id != null ? "pointer" : undefined,
													}}
													onClick={() => {
														if (item.record_id != null)
															setSelectedRecordId(item.record_id);
													}}
												>
													<TableCell style={{ whiteSpace: "nowrap" }}>
														<Text component="span" c="dimmed">
															{safeDate(item.created_at)}
														</Text>
													</TableCell>
													<TableCell>
														{item.record_id != null ? (
															<Text
																component="span"
																c="teal"
																ff="monospace"
																td="underline"
															>
																#{item.record_id}
															</Text>
														) : (
															<Text component="span" c="dimmed" opacity={0.4}>
																—
															</Text>
														)}
													</TableCell>
													<TableCell>
														<Badge variant="info">{purposeLabel(item)}</Badge>
													</TableCell>
													<TableCell>
														<Text component="span" c="dimmed" opacity={0.7}>
															{item.provider_name || "-"}
														</Text>
													</TableCell>
													<TableCell>
														<Badge
															variant={
																item.status === "success"
																	? "success"
																	: "danger"
															}
														>
															{item.status}
															{item.error_count > 0
																? ` (${item.error_count}错)`
																: ""}
														</Badge>
													</TableCell>
													<TableCell>
														<Text component="span" c="dimmed">
															{item.latency_ms != null
																? `${item.latency_ms}ms${item.is_aggregated ? " 均" : ""}`
																: "-"}
														</Text>
													</TableCell>
													<TableCell>
														{item.total_tokens != null
															? `${item.total_tokens}${item.token_estimated ? "~" : ""}`
															: "-"}
													</TableCell>
													<TableCell>
														<Text component="span" c="yellow">
															{item.estimated_cost != null
																? `¥${Number(item.estimated_cost).toFixed(4)}`
																: "-"}
														</Text>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</ScrollArea>
								<Pagination
									total={logTotal}
									offset={offset}
									limit={LIMIT}
									onChange={setOffset}
								/>
								{selectedRecordId != null && (
									<Box mt="md">
										<CallLogTimeline
											recordId={selectedRecordId}
											onBack={() => setSelectedRecordId(null)}
										/>
									</Box>
								)}
							</>
						)}
					</Paper>
				</Grid.Col>
			</Grid>
		</>
	);
}
