import { Badge, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { EXAMPLE_CONVERSATIONS } from "../data";

const AVATAR_COLOR: Record<string, string> = {
	defensive: "var(--mantine-color-red-6)",
	trusting: "var(--mantine-color-blue-6)",
	normal: "var(--mantine-color-green-6)",
};

export default function ConversationSnippets() {
	const [activeId, setActiveId] = useState(EXAMPLE_CONVERSATIONS[0].id);

	const active = EXAMPLE_CONVERSATIONS.find((c) => c.id === activeId) ?? EXAMPLE_CONVERSATIONS[0];

	return (
		<Paper
			withBorder
			radius="md"
			p="lg"
			pos="relative"
			style={{ minHeight: 460, display: "flex", flexDirection: "column", overflow: "hidden" }}
		>
			<Group justify="space-between" gap="md" pos="relative" style={{ zIndex: 10 }}>
				<Stack gap={4}>
					<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
						对话示例
					</Text>
					<Text size="lg" fw={700}>
						虚拟患者交流风格
					</Text>
				</Stack>
				<Badge variant="default" radius="xl">
					{active.emotionLabel}
				</Badge>
			</Group>

			<Group gap={8} mt="lg" pos="relative" style={{ zIndex: 10 }}>
				{EXAMPLE_CONVERSATIONS.map((conv) => (
					<Badge
						key={conv.id}
						component="button"
						onClick={() => setActiveId(conv.id)}
						variant={activeId === conv.id ? "light" : "default"}
						radius="md"
						style={{ cursor: "pointer" }}
					>
						{conv.title}
					</Badge>
				))}
			</Group>

			<Stack gap="md" mt="lg" pos="relative" style={{ zIndex: 10, minHeight: 340 }}>
				{active.lines.map((line, index) => (
					<Group
						key={`${active.id}-${index}`}
						gap={12}
						justify={line.speaker === "patient" ? "flex-start" : "flex-end"}
						wrap="nowrap"
					>
						{line.speaker === "patient" && (
							<Box
								style={{
									marginTop: 4,
									width: 32,
									height: 32,
									borderRadius: "50%",
									border: "1px solid var(--mantine-color-default-border)",
									background: "var(--mantine-color-body)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: "xs",
									fontWeight: 700,
									color: AVATAR_COLOR[active.id],
									flexShrink: 0,
								}}
							>
								患
							</Box>
						)}
						<Box
							px="md"
							py={12}
							style={{
								maxWidth: "75%",
								borderRadius: "var(--mantine-radius-md)",
								...(line.speaker === "patient"
									? {
											borderTopLeftRadius: "var(--mantine-radius-xs)",
											border: "1px solid var(--mantine-color-default-border)",
											background: "var(--mantine-color-body)",
										}
									: {
											borderTopRightRadius: "var(--mantine-radius-xs)",
											background: "var(--mantine-primary-color-filled)",
											color: "var(--mantine-primary-color-contrast)",
										}),
							}}
						>
							<Text size="sm" lh={1.6}>
								{line.text}
							</Text>
							{line.emotion && (
								<Text size="xs" fw={500} mt={4} opacity={0.6}>
									{line.emotion}
								</Text>
							)}
						</Box>
						{line.speaker === "nurse" && (
							<Box
								style={{
									marginTop: 4,
									width: 32,
									height: 32,
									borderRadius: "50%",
									border: "1px solid var(--mantine-color-default-border)",
									background: "var(--mantine-color-body)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: "xs",
									fontWeight: 700,
									color: "var(--mantine-color-dimmed)",
									flexShrink: 0,
								}}
							>
								护
							</Box>
						)}
					</Group>
				))}
			</Stack>
		</Paper>
	);
}
