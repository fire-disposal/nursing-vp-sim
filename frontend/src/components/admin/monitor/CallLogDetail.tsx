import { useQuery } from "@tanstack/react-query";
import {
	Alert,
	Box,
	Divider,
	Group,
	Paper,
	ScrollArea,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconBolt,
	IconClock,
	IconCpu,
	IconCurrencyDollar,
	IconFileText,
	IconHash,
} from "@tabler/icons-react";
import type { ComponentType, CSSProperties } from "react";
import { getLogDetail } from "@/api";
import { queryKeys } from "@/api/query-keys";
import Badge from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";

interface CallLogDetailProps {
	logId: number | null;
	onClose: () => void;
}

function safeDate(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString("zh-CN");
}

type IconType = ComponentType<{
	size?: number;
	className?: string;
	strokeWidth?: number;
	style?: CSSProperties;
}>;

function Block({
	label,
	content,
}: {
	label: string;
	content: string | null | undefined;
}) {
	if (!content) return null;
	return (
		<Box mb="md">
			<Text size="xs" fw={600} c="dimmed" mb={6} tt="uppercase">
				{label}
			</Text>
			<Paper withBorder radius="md" p="sm" bg="var(--mantine-color-gray-1)">
				<ScrollArea.Autosize mah={384}>
					<Text
						size="xs"
						ff="monospace"
						style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6 }}
					>
						{content}
					</Text>
				</ScrollArea.Autosize>
			</Paper>
		</Box>
	);
}

function MetaRow({
	icon: Icon,
	label,
	value,
}: {
	icon: IconType;
	label: string;
	value: string;
}) {
	return (
		<Group gap={8} py={6} wrap="nowrap">
			<Icon size={14} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
			<Text size="sm" c="dimmed" w={80} style={{ flexShrink: 0 }}>
				{label}
			</Text>
			<Text size="sm" fw={500} style={{ minWidth: 0, flex: 1 }}>
				{value}
			</Text>
		</Group>
	);
}

export default function CallLogDetail({ logId, onClose }: CallLogDetailProps) {
	const {
		data: log,
		isLoading,
		isError,
	} = useQuery({
		queryKey: queryKeys.llmCallLogs.detail(logId),
		queryFn: () => getLogDetail(logId!).then((r) => r.data),
		enabled: logId !== null,
	});

	return (
		<Sheet open={logId !== null} onClose={onClose} side="right" size="lg">
			<Box p="md">
				{isLoading && (
					<Text c="dimmed" ta="center" py="xl">
						加载中...
					</Text>
				)}
				{isError && (
					<Text c="red" ta="center" py="xl">
						加载失败
					</Text>
				)}
				{!isLoading && !isError && !log && (
					<Text c="dimmed" ta="center" py="xl">
						暂无数据
					</Text>
				)}
				{log && (
					<>
						<Group gap={8} mb="md">
							<IconFileText size={18} />
							<Title order={2}>调用详情 #{log.id}</Title>
						</Group>

						<Paper withBorder radius="lg" p="md" mb="md">
							<Stack gap={0}>
								<MetaRow
									icon={IconClock}
									label="时间"
									value={safeDate(log.created_at)}
								/>
								<MetaRow icon={IconHash} label="用途" value={log.purpose} />
								<MetaRow
									icon={IconCpu}
									label="模型"
									value={`${log.provider_name || "—"} / ${log.model || "—"}`}
								/>
								<MetaRow
									icon={IconBolt}
									label="延迟"
									value={log.latency_ms != null ? `${log.latency_ms}ms` : "—"}
								/>
								<MetaRow
									icon={IconHash}
									label="Token"
									value={
										[
											log.prompt_tokens != null ? `P:${log.prompt_tokens}` : "",
											log.completion_tokens != null
												? `C:${log.completion_tokens}`
												: "",
											log.total_tokens != null ? `T:${log.total_tokens}` : "",
											log.token_estimated ? "(估)" : "",
										]
											.filter(Boolean)
											.join(" ") || "—"
									}
								/>
								<MetaRow
									icon={IconCurrencyDollar}
									label="费用"
									value={
										log.estimated_cost != null
											? `¥${Number(log.estimated_cost).toFixed(6)} ${log.cost_currency || ""}`.trim()
											: "—"
									}
								/>
								<Divider my="sm" />
								<Group gap={8} wrap="nowrap">
									<IconAlertCircle
										size={14}
										style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }}
									/>
									<Text size="sm" c="dimmed" w={80} style={{ flexShrink: 0 }}>
										状态
									</Text>
									<Badge
										variant={log.status === "success" ? "success" : "danger"}
									>
										{log.status}
									</Badge>
									{log.error_type && (
										<Badge variant="warning">{log.error_type}</Badge>
									)}
								</Group>
								{log.error_message && (
									<Alert color="red" mt="sm">
										{log.error_message}
									</Alert>
								)}
							</Stack>
						</Paper>

						<Block
							label="System Prompt + Messages (请求)"
							content={log.request_text}
						/>
						<Block
							label="LLM Response (响应)"
							content={log.response_text}
						/>
					</>
				)}
			</Box>
		</Sheet>
	);
}
