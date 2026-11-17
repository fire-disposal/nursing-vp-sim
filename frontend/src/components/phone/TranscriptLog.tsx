import { Box, Flex, Group, ScrollArea, Stack, Text } from "@mantine/core";
import type { PhoneCallLine, PhoneCallMetrics } from "@/engine/phone/usePhoneCall";
import { USER_INTENT_LABELS, type PhoneLogEntry } from "@/engine/phone/types";

/**
 * TranscriptLog —— 实时转写 + 事件日志（中栏下半部分）。
 *
 * 两栏都是**原始事件**：左侧是学生对答记录（学生说了什么 / 对方回了什么），
 * 右侧是带时间戳的引擎事件（情绪增量、打断停播、首块音频……）。演示页的价值
 * 有一半在这些数字上，所以宁可显示出来，也不藏在控制台。
 */
export interface TranscriptLogProps {
	lines: PhoneCallLine[];
	log: PhoneLogEntry[];
	metrics: PhoneCallMetrics;
	/** 实时转写（学生正在说的一句话，尚未提交）。 */
	liveTranscript: string;
	height?: number;
	/** 窄屏：转写与事件日志上下排列，避免两列各挤到不可读。 */
	stacked?: boolean;
}

function ms(value: number | null): string {
	return value === null ? "—" : `${value}ms`;
}

export default function TranscriptLog({
	lines,
	log,
	metrics,
	liveTranscript,
	height = 240,
	stacked = false,
}: TranscriptLogProps) {
	return (
		<Stack gap="xs">
			<Group gap="lg" wrap="wrap" data-testid="metrics">
				<Text size="xs" c="dimmed">
					首块音频 <Text span fw={600} c="indigo">{ms(metrics.firstBlockMs)}</Text>
				</Text>
				<Text size="xs" c="dimmed">
					停播 <Text span fw={600} c="red">{ms(metrics.stopMs)}</Text>
				</Text>
				<Text size="xs" c="dimmed">
					判句 <Text span fw={600} c="teal">{ms(metrics.sentenceMs)}</Text>
				</Text>
				<Text size="xs" c="dimmed">
					音色 <Text span fw={600}>{metrics.voice ?? "默认"}</Text>
				</Text>
			</Group>
			<Flex align="stretch" gap="sm" direction={stacked ? "column" : "row"} style={{ minHeight: lines.length ? height : undefined }}>
				<ScrollArea
					h={lines.length ? height : undefined}
					style={{ flex: 1 }}
					type="auto"
					data-testid="transcript"
				>
					<Stack gap={6} pr={8}>
						{lines.length === 0 && (
							<Text size="xs" c="dimmed">
								等待通话开始。
							</Text>
						)}
						{lines.map((line) => (
							<Box key={line.id}>
								<Group gap={6} wrap="nowrap">
									<Text size="xs" fw={600} c={line.role === "user" ? "blue" : "grape"}>
										{line.role === "user" ? "我" : line.role === "patient" ? "对方" : "系统"}
									</Text>
									{line.tag && (
										<Text size="xs" c="dimmed">
											{USER_INTENT_LABELS[line.tag] ?? line.tag}
										</Text>
									)}
									{line.interrupted && (
										<Text size="xs" c="orange">
											{line.interruptedBy === "manual" ? "手动停播" : "学生打断"}
										</Text>
									)}
								</Group>
								<Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
									{line.text}
								</Text>
							</Box>
						))}
						{liveTranscript && (
							<Box>
								<Text size="xs" fw={600} c="blue">
									我（实时转写）
								</Text>
								<Text size="sm" fs="italic" c="dimmed">
									{liveTranscript}
								</Text>
							</Box>
						)}
					</Stack>
				</ScrollArea>
				{log.length > 0 && (
					<ScrollArea h={height} style={{ flex: 1 }} type="auto" data-testid="event-log">
						<Stack gap={2} pr={8}>
							{log
								.slice()
								.reverse()
								.map((entry) => (
									<Text key={entry.id} size="xs" c={entry.kind === "error" ? "red" : "dimmed"} ff="monospace">
										{new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })} · {entry.kind} ·{" "}
										{entry.text}
									</Text>
								))}
						</Stack>
					</ScrollArea>
				)}
			</Flex>
		</Stack>
	);
}
