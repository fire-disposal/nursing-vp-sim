import { Box, Button, Group, Text } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconMessageCircle } from "@tabler/icons-react";
import { useState } from "react";
import type { ScoreItemData } from "@/types/score";

interface ReviewItemProps {
	item: ScoreItemData;
	editedScore?: number;
	onChange: (itemId: number, newScore: number) => void;
}

export default function ReviewItem({ item, editedScore, onChange }: ReviewItemProps) {
	const [expanded, setExpanded] = useState(false);
	const hasEvidence = item.evidence || item.reason;
	const currentScore = editedScore !== undefined ? editedScore : item.score;
	const itemMax = Number.isFinite(item.max) && item.max! > 0 ? item.max! : 3;
	const scoreOptions = Array.from({ length: itemMax }, (_, i) => i + 1);

	const aiTier =
		item.score >= itemMax
			? "success"
			: item.score >= Math.ceil(itemMax * 0.6)
				? "neutral"
				: "danger";
	const aiColor = aiTier === "success" ? "green.8" : aiTier === "neutral" ? "gray.7" : "red.7";

	return (
		<Box mb={8}>
			<Group
				justify="space-between"
				align="flex-start"
				px="sm"
				py={10}
				wrap="wrap"
				gap="xs"
				style={{
					background: "var(--mantine-color-gray-1)",
					border: "1px solid var(--mantine-color-gray-3)",
					borderRadius: "var(--mantine-radius-md)",
				}}
			>
				<Box style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6} wrap="nowrap">
						<Text size="sm" fw={500}>
							{item.name}
						</Text>
						{hasEvidence && (
							<Button
								variant="subtle"
								color="gray"
								size="xs"
								p={0}
								onClick={() => setExpanded(!expanded)}
							>
								{expanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
							</Button>
						)}
					</Group>
					<Group gap={6} mt={2} wrap="nowrap">
						<Text size="xs" c="dimmed">
							AI 评分:{" "}
						</Text>
						<Text size="xs" fw={700} c={aiColor}>
							{item.score}/{itemMax}
						</Text>
					</Group>
				</Box>
				<Group gap={6}>
					{scoreOptions.map((s) => (
						<Button
							key={s}
							variant={currentScore === s ? "light" : "outline"}
							size="xs"
							w={32}
							h={32}
							p={0}
							onClick={() => onChange(item.id!, s)}
						>
							{s}
						</Button>
					))}
				</Group>
			</Group>
			{expanded && hasEvidence && (
				<Box
					ml="sm"
					mt="xs"
					px="sm"
					py={10}
					style={{
						background: "var(--mantine-color-gray-1)",
						border: "1px solid var(--mantine-color-gray-3)",
						borderRadius: "var(--mantine-radius-md)",
					}}
				>
					{item.evidence && (
						<Box mb={item.reason ? "xs" : undefined}>
							<Group gap={4} mb={2} wrap="nowrap">
								<IconMessageCircle size={11} />
								<Text size="xs" fw={600} c="dimmed">
									证据
								</Text>
							</Group>
							<Text size="xs" opacity={0.8}>
								{item.evidence}
							</Text>
						</Box>
					)}
					{item.reason && (
						<Box>
							<Text size="xs" fw={600} c="dimmed">
								理由：
							</Text>
							<Text size="xs" opacity={0.8}>
								{item.reason}
							</Text>
						</Box>
					)}
				</Box>
			)}
		</Box>
	);
}
