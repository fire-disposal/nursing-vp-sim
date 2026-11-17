import { Box, Group, ScrollArea, Stack, Text } from "@mantine/core";
import type { PhoneCallLine, PhoneCallMetrics } from "@/engine/phone/usePhoneCall";
import type { PhoneLogEntry } from "@/engine/phone/types";

export interface TranscriptLogProps {
	lines: PhoneCallLine[];
	log: PhoneLogEntry[];
	metrics: PhoneCallMetrics;
	liveTranscript: string;
	mode: "conversation" | "diagnostics";
	height?: number;
}

const LOG_KINDS: Record<PhoneLogEntry["kind"], string> = {
	user: "用户",
	patient: "对方",
	emotion: "情绪",
	system: "系统",
	asr: "识别",
	tts: "播报",
	error: "错误",
};

function ms(value: number | null): string {
	return value === null ? "—" : `${value}ms`;
}

/** 上方数据区是无控件的只读视图；切换对话/诊断的按钮在底部控制坞。 */
export default function TranscriptLog({
	lines,
	log,
	metrics,
	liveTranscript,
	mode,
	height = 380,
}: TranscriptLogProps) {
	if (mode === "diagnostics") {
		return (
			<Stack gap="md">
				<Group gap="lg" wrap="wrap" data-testid="metrics">
					<Text size="sm" c="dimmed">首块音频 <b>{ms(metrics.firstBlockMs)}</b></Text>
					<Text size="sm" c="dimmed">模型首字 <b>{ms(metrics.firstTokenMs)}</b></Text>
					<Text size="sm" c="dimmed">判句 <b>{ms(metrics.sentenceMs)}</b></Text>
					<Text size="sm" c="dimmed">停播 <b>{ms(metrics.stopMs)}</b></Text>
				</Group>
				<Text size="xs" c="dimmed">音色：{metrics.voice ?? "尚未返回"}</Text>
				<ScrollArea h={height - 70} type="auto" data-testid="event-log" offsetScrollbars>
					<Stack gap={6} pr="sm">
						{log.length === 0 && <Text size="sm" c="dimmed">暂无运行事件。</Text>}
						{log.slice(-40).reverse().map((entry) => (
							<Box key={entry.id} className="phone-event-row">
								<Text size="xs" c="dimmed" className="phone-event-meta">
									{new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })} {LOG_KINDS[entry.kind]}
								</Text>
								<Text size="sm" c={entry.kind === "error" ? "red" : undefined}>{entry.text}</Text>
							</Box>
						))}
					</Stack>
				</ScrollArea>
			</Stack>
		);
	}

	return (
		<Stack gap="sm">
			<ScrollArea h={height} type="auto" data-testid="transcript" offsetScrollbars>
				<Stack gap="sm" pr="sm" aria-live="polite">
					{lines.length === 0 && (
						<Box className="phone-conversation-empty">
							<Text size="sm" c="dimmed">暂无对话</Text>
						</Box>
					)}
					{lines.map((line) => (
						<Box key={line.id} className={`phone-message phone-message-${line.role}`}>
							<Group gap={6} justify={line.role === "user" ? "flex-end" : "flex-start"}>
								<Text size="xs" c="dimmed">{line.role === "user" ? "你" : "对方"}</Text>
								{line.state === "streaming" && <Text size="xs" c="dimmed">接收中</Text>}
								{line.state === "interrupted" && (
									<Text size="xs" c="orange">
										{line.interruptedBy === "manual" ? "手动停播" : "你插话后停播"}
									</Text>
								)}
							</Group>
							<Text className="phone-message-bubble">{line.text}</Text>
						</Box>
					))}
				</Stack>
			</ScrollArea>
			{liveTranscript && (
				<Box className="phone-live-preview" role="status">
					<Text size="xs" c="dimmed">正在识别，尚未发送</Text>
					<Text size="sm">{liveTranscript}</Text>
				</Box>
			)}
		</Stack>
	);
}
