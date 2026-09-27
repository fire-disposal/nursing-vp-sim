import { Badge, Box, Button, Group, Text } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconMessageCircle } from "@tabler/icons-react";
import { useState } from "react";
import type { RawScoreItemData } from "@/types/score";
import { itemStatusLabel } from "@/utils/score";

interface Props {
	item: RawScoreItemData;
	/** 原始量尺上限（0–rawScale），来自服务端复核基准 */
	rawScale: number;
	/** 病例声明本次不适用：不可编辑、不计入分母 */
	notApplicable: boolean;
	/** 教师已选分值；未选时以条目当前原始分为准 */
	editedScore?: number;
	onChange: (itemId: string, newScore: number) => void;
}

/**
 * 复核编辑器的**原始条目**行。
 *
 * 分值按钮只有 0–`rawScale`（rubric 原始刻度），没有展示刻度——教师改的是条目判定，
 * 展示分与总分的换算是服务端的事（docs/19 §4.2 第 6 条）。这里也不做任何分档着色：
 * 颜色阈值属于服务端等第政策，页面不得自行判定好坏。
 */
export default function ReviewItem({ item, rawScale, notApplicable, editedScore, onChange }: Props) {
	const [expanded, setExpanded] = useState(false);
	const hasEvidence = !!item.evidence || !!item.reason;
	const currentScore = editedScore !== undefined ? editedScore : item.score;
	const scoreOptions = Array.from({ length: rawScale + 1 }, (_, i) => i);
	const statusLabel = itemStatusLabel(item);
	const editDisabled = notApplicable;

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
					background: "var(--mantine-color-default-hover)",
					border: "1px solid var(--mantine-color-default-border)",
					borderRadius: "var(--mantine-radius-md)",
				}}
			>
				<Box style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6} wrap="nowrap">
						<Text size="sm" fw={500}>
							{item.name}
						</Text>
						{statusLabel && (
							<Badge variant="light" color={notApplicable ? "gray" : "yellow"} size="xs">
								{statusLabel}
							</Badge>
						)}
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
					<Group gap={6} mt={2} wrap="wrap">
						<Text size="xs" c="dimmed">
							{notApplicable ? "本次不适用（不计入分母）" : "AI 原始判定："}
						</Text>
						{!notApplicable && (
							<Text size="xs" fw={700}>
								{typeof item.score === "number" ? `${item.score}/${rawScale}` : `未判/${rawScale}`}
							</Text>
						)}
						{!notApplicable && item.score === null && (
							<Text size="11px" c="dimmed">
								复核提交时按 0 分计入，或由教师直接指定
							</Text>
						)}
					</Group>
				</Box>
				{!editDisabled && (
					<Group gap={6}>
						{scoreOptions.map((s) => (
							<Button
								key={s}
								variant={currentScore === s ? "light" : "outline"}
								size="xs"
								w={32}
								h={32}
								p={0}
								onClick={() => onChange(String(item.id), s)}
							>
								{s}
							</Button>
						))}
					</Group>
				)}
			</Group>
			{expanded && hasEvidence && (
				<Box
					ml="sm"
					mt="xs"
					px="sm"
					py={10}
					style={{
						background: "var(--mantine-color-default-hover)",
						border: "1px solid var(--mantine-color-default-border)",
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
