import { Box, Paper, Stack, Text } from "@mantine/core";
import { IconMessageCircle } from "@tabler/icons-react";
import { useEffect, useRef } from "react";

export interface MessageData {
	id: number;
	role: string;
	content: string;
}

interface Props {
	messages: MessageData[];
	/** 证据联动：高亮并滚动到该消息（工作台） */
	highlightId?: number | null;
}

/**
 * MessagePlayback — 对话回放（工作台左栏）。
 * 学生右侧气泡 / 患者左侧气泡；证据点击可定位到对应消息并高亮。
 */
export default function MessagePlayback({ messages, highlightId }: Props) {
	const highlightRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (highlightId == null) return;
		const el = highlightRef.current;
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			el.style.transition = "background-color 1.2s ease";
			el.style.backgroundColor = "var(--mantine-color-yellow-1)";
			const timer = window.setTimeout(() => {
				el.style.backgroundColor = "transparent";
			}, 2400);
			return () => window.clearTimeout(timer);
		}
	}, [highlightId]);

	return (
		<Paper
			withBorder
			radius="md"
			p={{ base: "md", sm: "lg" }}
			h="100%"
			style={{ display: "flex", flexDirection: "column" }}
		>
			<Text size="sm" fw={700} mb="sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<IconMessageCircle size={18} />
				对话回放（{messages.length} 条消息）
			</Text>
			<Box style={{ flex: 1, overflowY: "auto", minHeight: 240 }}>
				<Stack gap="xs" px={2}>
					{messages.map((msg) => {
						const isStudent = msg.role === "student";
						const isHighlighted = highlightId != null && msg.id === highlightId;
						return (
							<Box
								key={msg.id}
								ref={isHighlighted ? highlightRef : undefined}
								style={{
									display: "flex",
									justifyContent: isStudent ? "flex-end" : "flex-start",
									borderRadius: 8,
									padding: isHighlighted ? "2px 6px" : undefined,
								}}
							>
								<Box
									style={{
										maxWidth: "82%",
										padding: "6px 10px",
										borderRadius: 10,
										background: isStudent
											? "var(--mantine-color-brand-0)"
											: "var(--mantine-color-gray-0)",
										border: "1px solid var(--mantine-color-default-border)",
									}}
								>
									<Text size="xs" c="dimmed" mb={2}>
										{isStudent ? "学生" : "患者"}
									</Text>
									<Text size="sm" lh={1.6} style={{ whiteSpace: "pre-wrap" }}>
										{msg.content}
									</Text>
								</Box>
							</Box>
						);
					})}
				</Stack>
			</Box>
		</Paper>
	);
}
