import { Badge, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { useMemo } from "react";

const STATES = [
	{ trust: 70, comfort: 70, label: "open",     emoji: "😄", display: "开放信任", desc: "愿意详细叙述，主动补充信息", color: "green" },
	{ trust: 30, comfort: 60, label: "relaxed",  emoji: "😊", display: "放松友好", desc: "语气友好，配合回答", color: "blue" },
	{ trust: 30, comfort: 35, label: "neutral",  emoji: "🙂", display: "正常配合", desc: "中性叙述，按常规节奏交流", color: "gray" },
	{ trust: 30, comfort:  0, label: "anxious",  emoji: "😰", display: "焦虑不安", desc: "谨慎反复确认，语气急促", color: "grape" },
	{ trust:  0, comfort: 30, label: "defensive",emoji: "😟", display: "防御抵触", desc: "回避关键问题，短句回复", color: "orange" },
];

const FALLBACK = { label: "withdrawn", emoji: "😐", display: "沉默回避", desc: "不愿展开对话，回复极少", color: "red" };

const DOT_COLOR: Record<string, string> = {
	green: "var(--mantine-color-green-6)",
	blue: "var(--mantine-color-blue-6)",
	gray: "var(--mantine-color-gray-6)",
	grape: "var(--mantine-color-grape-6)",
	orange: "var(--mantine-color-orange-6)",
	red: "var(--mantine-color-red-6)",
};

export default function EmotionMatrix() {
	const active = useMemo(() => STATES[2], []); // neutral as demo

	return (
		<Paper withBorder radius="xl" p="lg" pos="relative" style={{ overflow: "hidden" }}>
			<Group justify="space-between" gap="md" pos="relative" style={{ zIndex: 10 }}>
				<Stack gap={4}>
					<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
						情绪状态机
					</Text>
					<Text size="lg" fw={700}>
						信任 × 舒适 (6 态)
					</Text>
				</Stack>
				<Badge variant="default" radius="xl">
					首次匹配
				</Badge>
			</Group>

			<Stack gap={10} mt="lg" pos="relative" style={{ zIndex: 10 }}>
				{STATES.map((s) => (
					<Group
						key={s.label}
						gap={12}
						p="md"
						wrap="nowrap"
						style={{
							border: "1px solid var(--mantine-color-default-border)",
							borderRadius: "var(--mantine-radius-md)",
							background: "var(--mantine-color-gray-0)",
						}}
					>
						<Text size="2rem" style={{ flexShrink: 0 }}>
							{s.emoji}
						</Text>
						<Box style={{ flex: 1, minWidth: 0 }}>
							<Group gap={8}>
								<Text size="sm" fw={700}>
									{s.display}
								</Text>
								<Text size="10px" tt="uppercase" c="dimmed">
									{s.label}
								</Text>
							</Group>
							<Text size="xs" c="dimmed" mt={2}>
								{s.desc}
							</Text>
							<Group gap={12} mt={6}>
								<Group gap={4}>
									<Box
										style={{
											width: 6,
											height: 6,
											borderRadius: "50%",
											background: DOT_COLOR[s.color],
										}}
									/>
									<Text size="10px" c="dimmed">
										信任 ≥ {s.trust}
									</Text>
								</Group>
								<Group gap={4}>
									<Box
										style={{
											width: 6,
											height: 6,
											borderRadius: "50%",
											background: DOT_COLOR[s.color],
										}}
									/>
									<Text size="10px" c="dimmed">
										舒适 ≥ {s.comfort}
									</Text>
								</Group>
							</Group>
						</Box>
					</Group>
				))}
				<Group
					gap={12}
					p="md"
					wrap="nowrap"
					style={{
						border: "1px dashed var(--mantine-color-default-border)",
						borderRadius: "var(--mantine-radius-md)",
						background: "var(--mantine-color-gray-0)",
					}}
				>
					<Text size="2rem" opacity={0.5} style={{ flexShrink: 0 }}>
						{FALLBACK.emoji}
					</Text>
					<Box style={{ flex: 1, minWidth: 0 }}>
						<Group gap={8}>
							<Text size="sm" fw={700} c="dimmed">
								{FALLBACK.display}
							</Text>
							<Text size="10px" tt="uppercase" c="dimmed" opacity={0.6}>
								{FALLBACK.label}
							</Text>
							<Text size="10px" c="dimmed" opacity={0.5}>
								通配 fallback
							</Text>
						</Group>
						<Text size="xs" c="dimmed" opacity={0.6} mt={2}>
							{FALLBACK.desc}
						</Text>
						<Group gap={4} mt={6}>
							<Box
								style={{
									width: 6,
									height: 6,
									borderRadius: "50%",
									background: DOT_COLOR[FALLBACK.color],
								}}
							/>
							<Text size="10px" c="dimmed" opacity={0.5}>
								不满足以上任意条件时
							</Text>
						</Group>
					</Box>
				</Group>
			</Stack>

			<Group
				justify="space-between"
				gap="md"
				p="lg"
				mt="lg"
				pos="relative"
				style={{
					zIndex: 10,
					border: "1px solid var(--mantine-color-default-border)",
					borderRadius: "var(--mantine-radius-md)",
					background: "var(--mantine-color-gray-0)",
				}}
			>
				<Stack gap={4}>
					<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
						匹配规则
					</Text>
					<Text size="sm" c="dimmed">
						从上到下首次匹配，无匹配则 withdrawn
					</Text>
				</Stack>
				<Badge variant="light" radius="xl">
					{active.display} {active.emoji}
				</Badge>
			</Group>
		</Paper>
	);
}
