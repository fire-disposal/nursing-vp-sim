import { useQuery } from "@tanstack/react-query";
import { Badge, Box, Button, Group, Paper, Text } from "@mantine/core";
import {
	IconArrowRight,
	IconBolt,
	IconClock,
	IconEye,
	IconHash,
} from "@tabler/icons-react";
import { useState } from "react";
import { getRecordLogs } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import CallLogDetail from "./CallLogDetail";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";

type LLMCallLogItem = components["schemas"]["LLMCallLogItem"];

interface CallLogTimelineProps {
	recordId: number;
	onBack: () => void;
}

function safeTime(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function statusColor(status: string): string {
	if (status === "success") return "var(--mantine-color-green-6)";
	if (status === "timeout") return "var(--mantine-color-yellow-6)";
	return "var(--mantine-color-red-6)";
}

function costStr(cost: number | null | undefined): string {
	if (cost == null) return "—";
	return `¥${Number(cost).toFixed(4)}`;
}

export default function CallLogTimeline({
	recordId,
	onBack,
}: CallLogTimelineProps) {
	const [selectedLogId, setSelectedLogId] = useState<number | null>(null);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.llmCallLogs.timeline(recordId),
		queryFn: () => getRecordLogs(recordId).then((r) => r.data),
	});

	const logs: LLMCallLogItem[] = data?.items ?? [];

	const totals = logs.reduce(
		(acc, l) => ({
			calls: acc.calls + 1,
			tokens: acc.tokens + (l.total_tokens ?? 0),
			cost: acc.cost + (l.estimated_cost ?? 0),
		}),
		{ calls: 0, tokens: 0, cost: 0 },
	);

	return (
		<Paper withBorder radius="md" p="md">
			<Group justify="space-between" mb="md" wrap="wrap">
				<Group gap={8}>
					<Button
						variant="subtle"
						color="gray"
						size="sm"
						w={36}
						h={36}
						p={0}
						onClick={onBack}
						aria-label="返回"
					>
						<IconArrowRight size={16} style={{ transform: "rotate(180deg)" }} />
					</Button>
					<Text size="sm" fw={600} c="dimmed">
						训练记录 #{recordId} 调用时间线
					</Text>
				</Group>
				<Group gap="md" wrap="nowrap">
					<Text size="xs" c="dimmed">
						{totals.calls} 次调用
					</Text>
					<Text size="xs" c="dimmed">
						{totals.tokens} token
					</Text>
					<Text size="xs" c="dimmed">
						{costStr(totals.cost)}
					</Text>
				</Group>
			</Group>

			{isLoading && <LoadingSkeleton variant="spinner" message="加载时间线..." />}
			{!isLoading && logs.length === 0 && (
				<EmptyState icon={IconClock} title="暂无调用记录" />
			)}
			{!isLoading && logs.length > 0 && (
				<Box style={{ position: "relative", paddingLeft: 24 }}>
					<Box
						style={{
							position: "absolute",
							left: 7,
							top: 8,
							bottom: 8,
							width: 1,
							background: "var(--mantine-color-gray-3)",
						}}
					/>
					{logs.map((log) => (
						<Box key={log.id} style={{ position: "relative", paddingBottom: 12 }}>
							<Box
								style={{
									position: "absolute",
									left: -17,
									top: 6,
									width: 15,
									height: 15,
									borderRadius: "50%",
									border: "2px solid var(--mantine-color-body)",
									background: statusColor(log.status),
								}}
							/>
							<Group justify="space-between" gap={8} wrap="nowrap" align="flex-start">
								<Box style={{ minWidth: 0, flex: 1 }}>
									<Group gap={8} wrap="wrap">
										<Text size="xs" c="dimmed" ff="monospace">
											{safeTime(log.created_at)}
										</Text>
										<Badge variant="light" color="blue" size="xs">
											{log.purpose}
										</Badge>
										<Text size="xs" c="dimmed" opacity={0.7}>
											{log.model || log.provider_name || "—"}
										</Text>
										<Badge
											variant="light"
											color={
												log.status === "success"
													? "green"
													: log.status === "timeout"
														? "yellow"
														: "red"
											}
											size="xs"
										>
											{log.status}
										</Badge>
									</Group>
									<Group gap={12} mt={2} wrap="nowrap">
										<Group gap={4} wrap="nowrap">
											<IconBolt size={10} />
											<Text size="xs" c="dimmed" opacity={0.7}>
												{log.latency_ms != null
													? `${log.latency_ms}ms`
													: "—"}
											</Text>
										</Group>
										<Group gap={4} wrap="nowrap">
											<IconHash size={10} />
											<Text size="xs" c="dimmed" opacity={0.7}>
												{log.total_tokens ?? "—"}
												{log.token_estimated ? "~" : ""}
											</Text>
										</Group>
										<Group gap={4} wrap="nowrap">
											<Text size="xs" c="dimmed" opacity={0.7}>
												{costStr(log.estimated_cost)}
											</Text>
										</Group>
									</Group>
								</Box>
								<Button
									variant="transparent"
									size="xs"
									onClick={() => setSelectedLogId(log.id)}
								>
									<IconEye size={12} />
									查看
								</Button>
							</Group>
						</Box>
					))}
				</Box>
			)}

			<CallLogDetail
				logId={selectedLogId}
				onClose={() => setSelectedLogId(null)}
			/>
		</Paper>
	);
}
