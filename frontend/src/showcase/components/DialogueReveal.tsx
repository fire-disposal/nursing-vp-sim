import { Badge, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { useState } from "react";

const STEPS = [
	{ label: "初始", text: "轻度回避，仅给出零散信息。", tone: "var(--mantine-color-gray-6)" },
	{ label: "追问", text: "随提问逐步披露隐藏病史。", tone: "var(--mantine-color-cyan-6)" },
	{ label: "信任", text: "当沟通合适，主动补充细节。", tone: "var(--mantine-color-green-6)" },
];

export default function DialogueReveal() {
	const [active, setActive] = useState(1);

	return (
		<Paper withBorder radius="md" p="lg" pos="relative" style={{ overflow: "hidden" }}>
			<Group justify="space-between" gap="md" pos="relative" style={{ zIndex: 10 }}>
				<Stack gap={4}>
					<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
						对话解锁
					</Text>
					<Text size="lg" fw={700}>
						信息按互动逐层展开
					</Text>
				</Stack>
				<Badge variant="default" radius="xl">
					tap / hover
				</Badge>
			</Group>

			<Stack gap={12} mt="lg" pos="relative" style={{ zIndex: 10 }}>
				{STEPS.map((step, index) => {
					const isActive = active === index;
					const shown = index <= active;
					return (
						<Paper
							key={step.label}
							component="button"
							onMouseEnter={() => setActive(index)}
							onFocus={() => setActive(index)}
							onClick={() => setActive(index)}
							p="md"
							radius="md"
							style={{
								textAlign: "left",
								cursor: "pointer",
								transition: "all 300ms",
								background: isActive
									? "var(--mantine-color-body)"
									: "var(--mantine-color-gray-0)",
								border: isActive
									? "1px solid var(--mantine-primary-color-3)"
									: "1px solid var(--mantine-color-default-border)",
								boxShadow: isActive ? "var(--mantine-shadow-md)" : undefined,
							}}
						>
							<Group gap="md" align="flex-start" wrap="nowrap">
								<Box
									style={{
										marginTop: 4,
										width: 10,
										height: 10,
										borderRadius: "50%",
										background: step.tone,
										opacity: shown ? 1 : 0.3,
										flexShrink: 0,
									}}
								/>
								<Box style={{ minWidth: 0, flex: 1 }}>
									<Group justify="space-between" gap="md">
										<Text size="sm" fw={700}>
											{step.label}
										</Text>
										<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.25em" }}>
											step {index + 1}
										</Text>
									</Group>
									<Text size="xs" c="dimmed" mt={4} lh={1.6}>
										{step.text}
									</Text>
								</Box>
							</Group>
						</Paper>
					);
				})}
			</Stack>
		</Paper>
	);
}
