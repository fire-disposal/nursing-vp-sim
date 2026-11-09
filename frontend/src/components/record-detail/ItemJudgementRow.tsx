import { Badge, Box, Group, Text } from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useState } from "react";
import type { RawScoreItemData } from "@/types/score";
import { itemStatusLabel, messageRefIds } from "@/utils/score";
import EvidenceBlock from "./EvidenceBlock";
import type { ItemJudgementSource } from "./record-view";

interface Props {
	item: RawScoreItemData;
	/** 这一行是谁判的（服务端给定的来源层）：教师复核层条目 or AI 初评层条目 */
	source: ItemJudgementSource;
	/** 证据 → 对话回放联动（点击后按服务端给出的 message id 高亮） */
	onMessageClick?: (messageId: number | string) => void;
}

const SOURCE_LABELS: Record<ItemJudgementSource, string> = {
	ai: "AI 初评",
	review: "教师复核",
};

/**
 * 逐项判定行 —— 消费**原始层**条目：分数是原始量尺（0..raw_scale）而不是换算后的
 * 展示分，状态与证据也以原始层为准。
 *
 * 每行都带**来源徽章**（AI 初评 / 教师复核）：教师条目层没有 evidence/reason，学生必须
 * 能一眼看出这一行是谁判的，不能让教师判定与 AI 判定混成一件事。
 *
 * 状态文案不留空档：已判定显示原始分/满分；`not_applicable` → 「本次不适用」；
 * `unscored_by_model`（或无分数）→ 「系统未判定」。
 */
export default function ItemJudgementRow({ item, source, onMessageClick }: Props) {
	const statusLabel = itemStatusLabel(item);
	const messageIds = messageRefIds(item.evidence_refs);
	const hasDetail = !!(item.evidence || item.reason);
	const [expanded, setExpanded] = useState(() => item.score != null && item.score < (item.max ?? 2) * 0.6);

	const max = typeof item.max === "number" && item.max > 0 ? item.max : 2;
	const ratio = item.score == null ? null : item.score / max;
	// 数值颜色只表达"这次得分落在量尺哪一段"，不是能力结论
	const tier = ratio == null ? "none" : ratio >= 1 ? "success" : ratio >= 0.5 ? "neutral" : "danger";
	const bg =
		tier === "success"
			? "var(--mantine-color-green-light)"
			: tier === "neutral"
				? "var(--mantine-color-default-hover)"
				: tier === "danger"
					? "var(--mantine-color-red-light)"
					: "var(--mantine-color-default-hover)";
	const fg =
		tier === "success"
			? "var(--mantine-color-green-light-color)"
			: tier === "neutral"
				? "var(--mantine-color-dimmed)"
				: tier === "danger"
					? "var(--mantine-color-red-light-color)"
					: "var(--mantine-color-dimmed)";

	return (
		<Box mb={4} data-judgement-source={source}>
			<Group
				justify="space-between"
				px="sm"
				py="xs"
				wrap="nowrap"
				onClick={() => hasDetail && setExpanded(!expanded)}
				style={{
					background: bg,
					borderRadius: "var(--mantine-radius-md)",
					cursor: hasDetail ? "pointer" : "default",
				}}
			>
				<Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
					{hasDetail && (
						<span style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }}>
							{expanded ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
						</span>
					)}
					<Text size="sm" truncate>
						{item.name}
					</Text>
					<Badge variant="light" color={source === "review" ? "green" : "brand"} size="xs">
						{SOURCE_LABELS[source]}
					</Badge>
					{statusLabel && (
						<Badge variant="light" color={item.status === "not_applicable" ? "gray" : "yellow"} size="xs">
							{statusLabel}
						</Badge>
					)}
				</Group>
				{typeof item.score === "number" ? (
					<Text size="sm" fw={700} c={fg} style={{ marginLeft: 8, flexShrink: 0 }}>
						{item.score}/{max}
					</Text>
				) : (
					<Text size="sm" c="dimmed" style={{ marginLeft: 8, flexShrink: 0 }}>
						—
					</Text>
				)}
			</Group>
			<Box
				style={{
					overflow: "hidden",
					maxHeight: expanded && hasDetail ? 400 : 0,
					opacity: expanded && hasDetail ? 1 : 0,
					transition: "all 300ms",
					marginTop: expanded && hasDetail ? 4 : 0,
					marginLeft: expanded && hasDetail ? 16 : 0,
				}}
			>
				<EvidenceBlock
					evidence={item.evidence}
					reason={item.reason}
					evidenceVerified={item.evidence_verified}
					messageIds={messageIds}
					onMessageClick={onMessageClick}
				/>
			</Box>
		</Box>
	);
}
