import {
	Badge,
	Box,
	Button,
	Group,
	Paper,
	Progress,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	IconAlertTriangle,
	IconBulb,
	IconCircleCheck,
	IconDownload,
	IconEye,
	IconPencil,
	IconShieldCheck,
	IconThumbDown,
	IconThumbUp,
	IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { CollapsibleSection, ScoreItem } from "@/components/record-review";
import type { DetailScoreCategory, ScoreData } from "@/types/score";

interface ReviewData {
	review_status?: string | null;
	reviewed_by_name?: string | null;
	reviewed_at?: string | null;
	review_comment?: string | null;
}

interface ScoreReviewData {
	detail_scores?: Record<string, unknown> | null;
	total_score?: number | null;
	comment?: string | null;
	reviewed_at?: string | null;
}

interface Props {
	recordScore: ScoreData;
	isReviewed: boolean;
	review: ReviewData | null;
	scoreReview: ScoreReviewData | null;
	isTeacher: boolean;
	expanded: Record<string, boolean>;
	onToggleExpand: (key: string) => void;
	onReviewClick: () => void;
	onExport: () => void;
	onDetailedScoreClick: () => void;
	scoreMax: number;
	categories: [string, DetailScoreCategory][];
	hasDetailItems: boolean;
}

function progressColor(pct: number): string {
	if (pct >= 80) return "green";
	if (pct >= 50) return "yellow";
	return "red";
}

export default function ScoreResultSection({
	recordScore,
	isReviewed,
	review,
	scoreReview,
	isTeacher,
	expanded,
	onToggleExpand,
	onReviewClick,
	onExport,
	onDetailedScoreClick,
	scoreMax,
	categories,
	hasDetailItems,
}: Props) {
	const [showAiOriginal, setShowAiOriginal] = useState(false);

	const displayTotal = scoreReview?.total_score ?? recordScore.total_score;
	const hasReviewOverride =
		scoreReview?.total_score != null &&
		scoreReview.total_score !== recordScore.total_score;

	return (
		<Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
			<Stack gap="md">
				<Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
					<Group gap={10} wrap="wrap">
						<Title order={3} size="md">
							评分结果
						</Title>
						{isReviewed ? (
							<Badge variant="light" color="green">
								<IconShieldCheck size={12} /> 教师已复核
							</Badge>
						) : (
							<Badge variant="light" color="blue">AI 初评</Badge>
						)}
						{isReviewed && review?.reviewed_by_name && (
							<Text size="xs" c="dimmed">
								复核人: {review.reviewed_by_name}
								{review.reviewed_at &&
									` · ${new Date(review.reviewed_at).toLocaleDateString("zh-CN")}`}
							</Text>
						)}
					</Group>
					<Group gap="xs" wrap="wrap">
						{isTeacher && (
							<Button variant="outline" size="sm" onClick={onReviewClick}>
								<IconPencil size={14} />{" "}
								{isReviewed ? "修改复核" : "复核评分"}
							</Button>
						)}
						<Button size="sm" onClick={onDetailedScoreClick}>
							查看详细评分
						</Button>
						<Button variant="outline" size="sm" onClick={onExport}>
							<IconDownload size={14} />
							导出记录
						</Button>
					</Group>
				</Group>

				<Group align="baseline" gap={8}>
					<Text size="40px" fw={800} c="teal" lh={1}>
						{displayTotal}
					</Text>
					<Text size="md" c="dimmed">
						/ {scoreMax} 分
					</Text>
				</Group>

				{hasReviewOverride && (
					<Text size="xs" c="dimmed">
						AI 原始评分: {recordScore.total_score}/{scoreMax}
					</Text>
				)}

				{isReviewed && review?.review_comment && (
					<Paper withBorder radius="md" bg="gray.0" px="md" py="sm">
						<Text size="sm">
							<Text component="span" fw={600} c="dimmed">
								复核备注：
							</Text>
							{review.review_comment}
						</Text>
					</Paper>
				)}

				{hasDetailItems && (
					<Stack gap="md" pt="xs" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
						{categories.map(([catName, catData]) => {
							if (!Array.isArray(catData.items) || catData.items.length === 0)
								return null;
							const pct =
								catData.max > 0
									? Math.round((catData.score / catData.max) * 100)
									: 0;
							const isReviewedDim =
								(catData as unknown as Record<string, unknown>)._reviewed === true;
							return (
								<Stack key={catName} gap="xs">
									<Group justify="space-between">
										<Group gap="xs">
											<Text size="sm" fw={600}>
												{catName}
											</Text>
											{isReviewedDim && (
												<Badge variant="light" color="green" size="xs">
													已复核
												</Badge>
											)}
										</Group>
										<Text
											size="sm"
											c="dimmed"
											style={{ fontVariantNumeric: "tabular-nums" }}
										>
											{catData.score}/{catData.max}
										</Text>
									</Group>
									<Progress value={pct} color={progressColor(pct)} size="sm" radius="md" />
									<Stack gap={2} mt={4}>
										{catData.items.map((item, i) => (
											<ScoreItem key={item.id || i} item={item} />
										))}
									</Stack>
								</Stack>
							);
						})}

						{isReviewed && scoreReview && (
							<CollapsibleSection
								icon={<IconEye size={16} style={{ color: "var(--mantine-color-gray-6)" }} />}
								title="AI 原始评分"
								expanded={expanded.ai_original ?? showAiOriginal}
								onToggle={() => {
									setShowAiOriginal((prev) => !prev);
									onToggleExpand("ai_original");
								}}
							>
								<Stack gap="md">
									<Group align="baseline" gap={8}>
										<Text size="xl" fw={700} c="dimmed">
											{recordScore.total_score}
										</Text>
										<Text size="sm" c="dimmed">
											/ {scoreMax} 分
										</Text>
									</Group>
									{recordScore.detail_scores && (
										<Stack gap="xs">
											{Object.entries(recordScore.detail_scores).map(
												([dimName, dimData]) => {
													if (!dimData || typeof dimData !== "object")
														return null;
													const d = dimData as DetailScoreCategory;
													if (!Array.isArray(d.items) || d.items.length === 0)
														return null;
													const aiPct =
														d.max > 0
															? Math.round((d.score / d.max) * 100)
															: 0;
													return (
														<Stack key={dimName} gap={4}>
															<Group justify="space-between">
																<Text size="xs" fw={500} c="dimmed">
																	{dimName}
																</Text>
																<Text
																	size="xs"
																	c="dimmed"
																	style={{ fontVariantNumeric: "tabular-nums" }}
																>
																	{d.score}/{d.max}
																</Text>
															</Group>
															<Progress
																value={aiPct}
																color={progressColor(aiPct)}
																size="xs"
																radius="md"
																style={{ opacity: 0.6 }}
															/>
														</Stack>
													);
												},
											)}
										</Stack>
									)}
								</Stack>
							</CollapsibleSection>
						)}
					</Stack>
				)}

				<CollapsibleSection
					icon={<IconThumbUp size={16} />}
					title="表现较好"
					expanded={expanded.strengths}
					onToggle={() => onToggleExpand("strengths")}
				>
					{recordScore.strengths && recordScore.strengths.length > 0 ? (
						<Stack gap={6}>
							{recordScore.strengths.map((s, i) => (
								<Group key={i} gap="xs" align="flex-start" wrap="nowrap">
									<IconCircleCheck
										size={14}
										style={{ color: "var(--mantine-color-green-5)", flexShrink: 0, marginTop: 2 }}
									/>
									<Text size="sm" c="dimmed">
										{s}
									</Text>
								</Group>
							))}
						</Stack>
					) : (
						<Text size="sm" c="dimmed" fs="italic" opacity={0.5}>
							AI 未生成此部分内容，可重新评分获取完整报告
						</Text>
					)}
				</CollapsibleSection>

				<CollapsibleSection
					icon={<IconThumbDown size={16} />}
					title="需要改善"
					expanded={expanded.weaknesses}
					onToggle={() => onToggleExpand("weaknesses")}
				>
					{recordScore.weaknesses && recordScore.weaknesses.length > 0 ? (
						<Stack gap={6}>
							{recordScore.weaknesses.map((w, i) => (
								<Group key={i} gap="xs" align="flex-start" wrap="nowrap">
									<Box
										style={{
											width: 14,
											height: 14,
											borderRadius: "50%",
											border: "2px solid var(--mantine-color-yellow-4)",
											flexShrink: 0,
											marginTop: 2,
										}}
									/>
									<Text size="sm" c="dimmed">
										{w}
									</Text>
								</Group>
							))}
						</Stack>
					) : (
						<Text size="sm" c="dimmed" fs="italic" opacity={0.5}>
							AI 未生成此部分内容，可重新评分获取完整报告
						</Text>
					)}
				</CollapsibleSection>

				<CollapsibleSection
					icon={<IconAlertTriangle size={16} style={{ color: "var(--mantine-color-red-5)" }} />}
					title="漏问内容"
					expanded={expanded.missed_content}
					onToggle={() => onToggleExpand("missed_content")}
				>
					{recordScore.missed_content && recordScore.missed_content.length > 0 ? (
						<Stack gap={6}>
							{recordScore.missed_content.map((m, i) => (
								<Group key={i} gap="xs" align="flex-start" wrap="nowrap">
									<IconX
										size={14}
										style={{ color: "var(--mantine-color-red-4)", flexShrink: 0, marginTop: 2 }}
									/>
									<Text size="sm" c="dimmed">
										{m}
									</Text>
								</Group>
							))}
						</Stack>
					) : (
						<Text size="sm" c="dimmed" fs="italic" opacity={0.5}>
							AI 未生成此部分内容，可重新评分获取完整报告
						</Text>
					)}
				</CollapsibleSection>

				<CollapsibleSection
					icon={<IconBulb size={16} style={{ color: "var(--mantine-color-blue-5)" }} />}
					title="改进建议"
					expanded={expanded.suggestions}
					onToggle={() => onToggleExpand("suggestions")}
				>
					{recordScore.suggestions ? (
						<Text size="sm" c="dimmed" lh={1.6}>
							{recordScore.suggestions}
						</Text>
					) : (
						<Text size="sm" c="dimmed" fs="italic" opacity={0.5}>
							AI 未生成改进建议，可重新评分获取完整报告
						</Text>
					)}
				</CollapsibleSection>
			</Stack>
		</Paper>
	);
}
