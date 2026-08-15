import { Box, Group, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconMessageCircle } from "@tabler/icons-react";
import { useState } from "react";
import type { ScoreItemData } from "@/types/score";

interface ScoreItemProps {
	item: ScoreItemData;
	/** 点击证据回调（结果页工作台：证据 ↔ 对话气泡联动） */
	onEvidenceClick?: (evidence: string) => void;
}

export default function ScoreItem({ item, onEvidenceClick }: ScoreItemProps) {
	const itemMax = Number.isFinite(item.max) && item.max! > 0 ? item.max! : 3;
	const [expanded, setExpanded] = useState(item.score < itemMax * 0.6);
	const hasEvidence = item.evidence || item.reason;

	const tier =
		item.score >= itemMax
			? "success"
			: item.score >= Math.ceil(itemMax * 0.6)
				? "neutral"
				: "danger";
	const bg =
		tier === "success"
			? "var(--mantine-color-green-1)"
			: tier === "neutral"
				? "var(--mantine-color-gray-1)"
				: "var(--mantine-color-red-1)";
	const fg = tier === "success" ? "green.8" : tier === "neutral" ? "gray.7" : "red.7";

	return (
		<Box mb={4}>
			<Group
				justify="space-between"
				px="sm"
				py="xs"
				wrap="nowrap"
				onClick={() => hasEvidence && setExpanded(!expanded)}
				style={{
					background: bg,
					borderRadius: "var(--mantine-radius-md)",
					cursor: hasEvidence ? "pointer" : "default",
				}}
			>
				<Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
					{hasEvidence && (
						<span style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }}>
							{expanded ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
						</span>
					)}
					<Text size="sm" truncate>
						{item.name}
					</Text>
				</Group>
				<Text size="sm" fw={700} c={fg} style={{ marginLeft: 8, flexShrink: 0 }}>
					{item.score}/{itemMax}
				</Text>
			</Group>
			<Box
				style={{
					overflow: "hidden",
					maxHeight: expanded && hasEvidence ? 300 : 0,
					opacity: expanded && hasEvidence ? 1 : 0,
					transition: "all 300ms",
					marginTop: expanded && hasEvidence ? 4 : 0,
					marginLeft: expanded && hasEvidence ? 16 : 0,
				}}
			>
				<Box
					p="sm"
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
								<Text size="sm" fw={600} c="dimmed">
									证据
								</Text>
							</Group>
							{onEvidenceClick ? (
								<UnstyledButton
									onClick={() => onEvidenceClick(item.evidence ?? "")}
									style={{ textAlign: "left", width: "100%" }}
									aria-label="在对话中定位该证据"
								>
									<Text size="sm" opacity={0.8} td="underline" c="brand">
										{item.evidence}
									</Text>
								</UnstyledButton>
							) : (
								<Text size="sm" opacity={0.8}>
									{item.evidence}
								</Text>
							)}
						</Box>
					)}
					{item.reason && (
						<Box>
							<Text size="sm" fw={600} c="dimmed">
								理由：
							</Text>
							<Text size="sm" opacity={0.8}>
								{item.reason}
							</Text>
						</Box>
					)}
				</Box>
			</Box>
		</Box>
	);
}
