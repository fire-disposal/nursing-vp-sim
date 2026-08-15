import { useQuery } from "@tanstack/react-query";
import { Box, Paper, Stack, Text } from "@mantine/core";
import { IconActivity } from "@tabler/icons-react";
import { useMemo } from "react";
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { getEmotionEvents, type EmotionEventItem } from "@/api/training";

interface Props {
	recordId: string;
}

const EVENT_LABELS: Record<string, string> = {
	empathy: "共情",
	active_listening: "积极倾听",
	clear_explanation: "清晰解释",
	respectful_communication: "尊重沟通",
	reassurance: "安抚",
	explains_procedure: "解释操作",
	respects_refusal: "尊重拒绝",
	request_cooperation: "礼貌请求配合",
	interruption: "打断",
	repeated_question: "重复提问",
	judgmental_language: "评判性语言",
	privacy_intrusion: "隐私冒犯",
	long_wait: "长时间等待",
	fatigue: "对话疲劳",
};

const LINE_DEFS = [
	{ key: "trust", name: "信任", color: "var(--mantine-color-green-6)" },
	{ key: "anxiety", name: "焦虑", color: "var(--mantine-color-violet-5)" },
	{ key: "irritation", name: "烦躁", color: "var(--mantine-color-orange-5)" },
	{ key: "cooperation", name: "配合", color: "var(--mantine-color-blue-5)" },
] as const;

/**
 * EmotionTrajectory — 情绪轨迹图（U6）。
 * README 卖点"情感追踪—轨迹可视化"的兑现：事件驱动，每次情绪事件的
 * 4D 状态快照连成曲线，事件点标注类型与证据。
 */
export function EmotionTrajectory({ recordId }: Props) {
	const { data: events, isLoading } = useQuery({
		queryKey: ["record", recordId, "emotion-events"],
		queryFn: () => getEmotionEvents(recordId),
		enabled: !!recordId,
		staleTime: 5 * 60_000,
	});

	const chartData = useMemo(
		() =>
			(events ?? []).map((e: EmotionEventItem, i: number) => ({
				index: i + 1,
				turn: e.turn_id ?? `#${i + 1}`,
				event: EVENT_LABELS[e.event_type] ?? e.event_type,
				evidence: e.evidence ?? "",
				...e.after_state,
			})),
		[events],
	);

	if (isLoading) return null;
	if (!chartData.length) return null;

	return (
		<Paper withBorder radius="md" p="md">
			<Stack gap="xs">
				<Text size="sm" fw={700} style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<IconActivity size={18} />
					情绪轨迹（{chartData.length} 个事件）
				</Text>
				<Box h={180}>
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
							<CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-gray-2)" />
							<XAxis dataKey="index" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
							<YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
							<Tooltip
								content={({ active, payload }) => {
									if (!active || !payload?.length) return null;
									const p = payload[0].payload as (typeof chartData)[number];
									return (
										<Box
											style={{
												background: "var(--mantine-color-body)",
												border: "1px solid var(--mantine-color-default-border)",
												borderRadius: 6,
												padding: "6px 10px",
												fontSize: 12,
											}}
										>
											<Text fw={600}>事件：{p.event}</Text>
											{p.evidence && <Text c="dimmed">证据：{p.evidence.slice(0, 60)}</Text>}
										</Box>
									);
								}}
							/>
							{LINE_DEFS.map((l) => (
								<Line
									key={l.key}
									type="monotone"
									dataKey={l.key}
									name={l.name}
									stroke={l.color}
									dot={{ r: 2 }}
									strokeWidth={1.5}
								/>
							))}
						</LineChart>
					</ResponsiveContainer>
				</Box>
				<Legend wrapperStyle={{ fontSize: 11 }} />
			</Stack>
		</Paper>
	);
}
