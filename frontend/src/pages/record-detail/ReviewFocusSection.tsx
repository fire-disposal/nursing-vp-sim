import { Badge, Box, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconArrowRight, IconTargetArrow } from "@tabler/icons-react";
import { messageRefIds } from "@/utils/score";
import EvidenceBlock from "./EvidenceBlock";
import type { ReviewFocusItem } from "./record-view";

interface Props {
	focus: ReviewFocusItem[];
	/** 服务端对「为什么是这几条 / 为什么没有」的说明，空列表时也要显示 */
	note: string;
	onMessageClick?: (messageId: number | string) => void;
}

const KIND_LABELS: Record<string, string> = { missed: "漏问", partial: "得分不全" };

/**
 * 关键选择回看（docs/19 W5）—— 结果页先解释**少量**最值得回看的条目：
 * 每条都给原始得分、可定位证据、判定理由，以及「下次练习原则」。
 *
 * 没有可解释条目时按服务端 `review_focus_note` 显示明确空态：不生成确定性指导，
 * 也不编造条目。
 */
export default function ReviewFocusSection({ focus, note, onMessageClick }: Props) {
	return (
		<Paper withBorder p={{ base: "md", sm: "lg" }}>
			<Stack gap="sm">
				<Group gap={8} wrap="nowrap">
					<IconTargetArrow size={18} />
					<Title order={3} size="md">
						关键选择回看
					</Title>
				</Group>

				{focus.length === 0 ? (
					<Text size="sm" c="dimmed" fs="italic">
						{note || "本次没有需要单独解释的关键条目。"}
					</Text>
				) : (
					<>
						{note && (
							<Text size="xs" c="dimmed">
								{note}
							</Text>
						)}
						<Stack gap="sm">
							{focus.map((entry) => (
								<Box
									key={`${entry.dimension}-${entry.item_id}`}
									p="sm"
									style={{
										border: "1px solid var(--mantine-color-default-border)",
										borderRadius: "var(--mantine-radius-md)",
									}}
								>
									<Group justify="space-between" wrap="nowrap" gap="xs" mb={6}>
										<Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
											<Text size="sm" fw={600} truncate>
												{entry.item_name}
											</Text>
											{entry.dimension && (
												<Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
													{entry.dimension}
												</Text>
											)}
										</Group>
										<Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
											{entry.key_omission && (
												<Badge variant="light" color="red" size="xs">
													<IconAlertTriangle size={10} /> 关键遗漏
												</Badge>
											)}
											<Badge variant="light" color={entry.kind === "missed" ? "red" : "yellow"} size="xs">
												{KIND_LABELS[entry.kind] ?? entry.kind}
											</Badge>
											<Text size="sm" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
												{entry.score}/{entry.max}
											</Text>
										</Group>
									</Group>

									<Stack gap={6}>
										<EvidenceBlock
											evidence={entry.evidence}
											reason={entry.reason}
											evidenceVerified={entry.evidence_verified}
											messageIds={messageRefIds(entry.evidence_refs)}
											onMessageClick={onMessageClick}
										/>
										{entry.principle && (
											<Group gap={6} align="flex-start" wrap="nowrap">
												<IconArrowRight
													size={14}
													style={{ color: "var(--mantine-color-blue-5)", flexShrink: 0, marginTop: 2 }}
												/>
												<Text size="sm">
													<Text component="span" fw={600} c="dimmed">
														下次练习原则：
													</Text>
													{entry.principle}
												</Text>
											</Group>
										)}
										{entry.typical_error && (
											<Text size="xs" c="dimmed">
												常见错误：{entry.typical_error}
											</Text>
										)}
									</Stack>
								</Box>
							))}
						</Stack>
					</>
				)}
			</Stack>
		</Paper>
	);
}
