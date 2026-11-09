import { APP_TIME_ZONE } from "@/utils/date";
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
import { CollapsibleSection } from "@/components/record-review";
import type {
	DetailScoreCategory,
	RawDetailScoreCategory,
	RawScoreItemData,
	ScoreData,
	ScoreReviewData,
} from "@/types/score";
import { getEffectiveTotal, resolveScoreSource, SCORE_SOURCE_LABELS } from "@/utils/score";
import FallbackNotice from "./FallbackNotice";
import GradeNotice from "./GradeNotice";
import ItemJudgementRow from "./ItemJudgementRow";
import { type ItemJudgementSource, toTeacherItemJudgements } from "./record-view";

interface ReviewData {
	review_status?: string | null;
	reviewed_by_name?: string | null;
	reviewed_at?: string | null;
	review_comment?: string | null;
}

interface Props {
	recordScore: ScoreData;
	isReviewed: boolean;
	review: ReviewData | null;
	scoreReview: ScoreReviewData | null;
	isTeacher: boolean;
	expanded: Record<string, boolean>;
	onToggleExpand: (key: string) => void;
	/** 教师端专属：打开复核编辑器。学生页不传 → 不渲染该按钮（避免空实现假按钮）。 */
	onReviewClick?: () => void;
	onExport: () => void;
	/** 证据 → 对话回放联动：按服务端解析出的 message id 直接高亮 */
	onMessageClick?: (messageId: number | string) => void;
	scoreMax: number;
	/** 展示层维度：维度分与进度条（逐项判定的来源另见 `scoreReview.detail_scores`） */
	categories: [string, DetailScoreCategory][];
	hasDetailItems: boolean;
	/** 原始层维度：有则逐项判定用原始量尺渲染（学生结果页） */
	rawCategories?: [string, RawDetailScoreCategory][];
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
	onMessageClick,
	scoreMax,
	categories,
	hasDetailItems,
	rawCategories,
}: Props) {
	const [showAiOriginal, setShowAiOriginal] = useState(false);

	const effectiveTotal = getEffectiveTotal(recordScore);
	const source = resolveScoreSource(recordScore);
	const reviewTotal = recordScore.reviewed_total ?? scoreReview?.total_score ?? null;
	// 空反馈的解释：为什么 weaknesses/missed_content 为空（服务端给的话术）
	const feedbackNote = recordScore.feedback_note ?? recordScore.score_meta?.feedback_note ?? null;
	const reviewerName = review?.reviewed_by_name ?? recordScore.reviewed_by_name ?? null;
	const reviewedAt = review?.reviewed_at ?? recordScore.reviewed_at ?? null;
	const reviewComment = review?.review_comment ?? recordScore.review_comment ?? null;
	const hasReviewScore = isReviewed || reviewTotal != null;
	// 逐项判定的真相源：服务端教师条目层非空 → 教师判定；否则 AI 初评层（raw_detail_scores）
	const teacherJudgements = toTeacherItemJudgements(scoreReview?.detail_scores);
	// 学生复盘的口径断层就在这里：总分可能是教师复核分，逐项可能仍来自 AI —— 必须写明
	const judgementSourceNote = teacherJudgements
		? "逐项判定以服务端教师复核层为准（原始量尺），标注「教师复核」；复核层未覆盖的维度仍是 AI 初评，标注「AI 初评」。"
		: hasReviewScore
			? "总分已由教师复核，逐项判定为 AI 初评，供复盘参考。"
			: "逐项判定为 AI 初评。";

	const emptyNotice = (label: string) => (
		<Stack gap={4}>
			<Text size="sm" c="dimmed" fs="italic">
				{label}
			</Text>
			{feedbackNote && (
				<Text size="xs" c="dimmed">
					{feedbackNote}
				</Text>
			)}
		</Stack>
	);

	return (
		<Paper withBorder p={{ base: "md", sm: "lg" }}>
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
							<Badge variant="light" color="brand">AI 初评</Badge>
						)}
						{recordScore.fallback != null && (
							<Badge variant="light" color="red">
								<IconAlertTriangle size={12} /> 系统降级
							</Badge>
						)}
					</Group>
					<Group gap="xs" wrap="wrap">
						{isTeacher && onReviewClick && (
							<Button variant="filled" color="brand" size="sm" onClick={onReviewClick}>
								<IconPencil size={14} />{" "}
								{isReviewed ? "修改复核" : "复核评分"}
							</Button>
						)}
						<Button variant="outline" size="sm" onClick={onExport}>
							<IconDownload size={14} />
							导出记录
						</Button>
					</Group>
				</Group>

				{/* 系统降级：先说清这次结果是怎么来的，再谈分数 */}
				<FallbackNotice fallback={recordScore.fallback} />

				{/* 有效成绩：分数旁边必须写明这个分是谁给的 */}
				<Group align="baseline" gap={8} wrap="wrap">
					<Text size="40px" fw={800} c="brand" lh={1} className="tabular-nums">
						{effectiveTotal ?? "—"}
					</Text>
					<Text size="md" c="dimmed">
						/ {scoreMax} 分
					</Text>
					<Badge variant="light" color={source === "fallback" ? "red" : source === "review" ? "green" : "brand"}>
						有效成绩来源：{SCORE_SOURCE_LABELS[source]}
					</Badge>
				</Group>

				{/* AI 初评 与 教师复核 分开呈现，谁也没覆盖谁 */}
				{hasReviewScore && (
					<Group gap="xl" wrap="wrap">
						<Stack gap={0}>
							<Text size="xs" c="dimmed">
								AI 初评
							</Text>
							<Text size="lg" fw={700} className="tabular-nums">
								{recordScore.total_score ?? "—"}
								<Text component="span" size="xs" c="dimmed">
									{" "}/ {scoreMax}
								</Text>
							</Text>
						</Stack>
						{reviewTotal != null && (
							<Stack gap={0}>
								<Text size="xs" c="dimmed">
									教师复核
								</Text>
								<Text size="lg" fw={700} className="tabular-nums">
									{reviewTotal}
									<Text component="span" size="xs" c="dimmed">
										{" "}/ {scoreMax}
									</Text>
								</Text>
							</Stack>
						)}
					</Group>
				)}

				{/* 数值分层与能力等第可用性：全部来自服务端政策 */}
				<GradeNotice grade={recordScore.grade} />

				{isReviewed && (reviewerName || reviewedAt) && (
					<Text size="xs" c="dimmed">
						复核人: {reviewerName || "—"}
						{reviewedAt && ` · ${new Date(reviewedAt).toLocaleString("zh-CN", { timeZone: APP_TIME_ZONE })}`}
					</Text>
				)}

				{isReviewed && reviewComment && (
					<Paper bg="var(--mantine-color-default-hover)" px="md" py="sm">
						<Text size="sm">
							<Text component="span" fw={600} c="dimmed">
								教师复核备注：
							</Text>
							{reviewComment}
						</Text>
					</Paper>
				)}

				{hasDetailItems && (
					<Stack gap="md" pt="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
						<Stack gap={2}>
							<Text size="xs" c="dimmed">
								逐维度得分为数值参考（展示分 {scoreMax} 分制），逐项判定按原始量尺给出，均不代表能力等第。
							</Text>
							<Text size="xs" c="dimmed">
								{judgementSourceNote}
							</Text>
						</Stack>
						{categories.map(([catName, catData]) => {
							if (!Array.isArray(catData.items) || catData.items.length === 0) return null;
							const rawCat = rawCategories?.find(([name]) => name === catName)?.[1];
							const rawItems = rawCat?.items?.length ? rawCat.items : null;
							// 来源以服务端字段为准：该维度在教师复核层里 → 教师判定，否则 AI 初评
							const teacherItems = teacherJudgements?.[catName] ?? null;
							const items: RawScoreItemData[] = teacherItems ?? rawItems ?? catData.items;
							const judgementSource: ItemJudgementSource = teacherItems ? "review" : "ai";
							const pct = catData.max > 0 ? Math.round((catData.score / catData.max) * 100) : 0;
							return (
								<Stack key={catName} gap="xs">
									<Group justify="space-between">
										<Text size="sm" fw={600}>
											{catName}
										</Text>
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
										{items.map((item, i) => (
											<ItemJudgementRow
												key={item.id != null ? String(item.id) : i}
												item={item}
												source={judgementSource}
												onMessageClick={onMessageClick}
											/>
										))}
									</Stack>
								</Stack>
							);
						})}

						{isReviewed && scoreReview && (
							<CollapsibleSection
								icon={<IconEye size={16} style={{ color: "var(--mantine-color-dimmed)" }} />}
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
												([dimName, d]) => {
													if (!d || !Array.isArray(d.items) || d.items.length === 0)
														return null;
													const aiPct = d.max > 0 ? Math.round((d.score / d.max) * 100) : 0;
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
						emptyNotice("本次无明确亮点")
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
						emptyNotice("本次无明确不足")
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
						emptyNotice("本次无漏问")
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
						emptyNotice("本次无改进建议")
					)}
				</CollapsibleSection>
			</Stack>
		</Paper>
	);
}
