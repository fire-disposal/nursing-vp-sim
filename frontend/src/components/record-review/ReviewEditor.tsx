import { Alert, Badge, Box, Button, Group, Loader, Modal, Stack, Text, Textarea } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { components } from "@/api/api-types.gen";
import {
	buildRawReviewPayload,
	reviewBasisNotice,
	toRawReviewDims,
	type RawReviewSubmitPayload,
} from "./review-payload";
import ReviewItem from "./ReviewItem";

type ScoreReviewResponse = components["schemas"]["ScoreReviewResponse"];

interface Props {
	/** `GET /training/records/{id}/review`：原始条目层 + 复核基准来源 */
	review: ScoreReviewResponse | null;
	loading: boolean;
	loadError: boolean;
	onReload: () => void;
	/** 展示分满分（分母），与结果区同一口径 */
	scoreMax: number;
	onSubmit: (detailScores: RawReviewSubmitPayload, comment: string) => void;
	onClose: () => void;
	submitting: boolean;
}

/** 初值：先铺 AI 原始判定，再用教师上次复核值覆盖（重新复核从教师自己的口径接着改） */
function seedScores(review: ScoreReviewResponse | null, rawScale: number): Record<string, number> {
	const seeded: Record<string, number> = {};
	for (const layer of [review?.original_raw_detail_scores, review?.review_detail_scores]) {
		const dims = toRawReviewDims(layer, rawScale);
		if (!dims) continue;
		for (const dim of Object.values(dims)) {
			for (const item of dim.items ?? []) {
				if (typeof item.score === "number") seeded[String(item.id)] = item.score;
			}
		}
	}
	return seeded;
}

/**
 * 教师复核编辑器 —— 编辑**原始条目层**（0–`raw_scale`），不是展示层。
 *
 * 数据只来自 `GET /records/{id}/review` 的 `original_raw_detail_scores` + `raw_scale`：
 * `score.detail_scores` 是展示投影（item.max ≈ 0–5），拿它当复核基准会让「不改条目直接
 * 提交」不再恒等（docs/19 §4.2 第 6 条）。历史记录没有原始层时，服务端用展示层反推并
 * 在 `review_basis` 里标明，这里必须把该说明原样告诉教师。
 */
export default function ReviewEditor({
	review,
	loading,
	loadError,
	onReload,
	scoreMax,
	onSubmit,
	onClose,
	submitting,
}: Props) {
	const rawScale = review?.raw_scale ?? 2;
	const notApplicableItems = useMemo(() => review?.not_applicable_items ?? [], [review]);
	const rawDims = useMemo(
		() => toRawReviewDims(review?.original_raw_detail_scores, rawScale),
		[review, rawScale],
	);
	const [comment, setComment] = useState(review?.review_comment ?? "");
	const [editedScores, setEditedScores] = useState<Record<string, number>>(() =>
		seedScores(review, rawScale),
	);

	const handleScoreChange = (itemId: string, newScore: number) => {
		setEditedScores((prev) => ({ ...prev, [itemId]: newScore }));
	};

	const handleSubmit = () => {
		if (!rawDims) return;
		onSubmit(buildRawReviewPayload(rawDims, editedScores, notApplicableItems, rawScale), comment);
	};

	const basisNotice = reviewBasisNotice(review?.review_basis);
	const rawTotal = Object.values(rawDims ?? {}).reduce(
		(sum, dim) => sum + (dim.items ?? []).reduce((dimSum, item) => dimSum + (item.score ?? 0), 0),
		0,
	);
	const applicableRawMax = review?.applicable_raw_max ?? null;

	return (
		<Modal opened onClose={onClose} title="教师复核评分（原始条目）" size={720} centered withinPortal>
			{loading ? (
				<Group justify="center" py="xl" gap="sm">
					<Loader size="sm" />
					<Text size="sm" c="dimmed">
						正在读取原始评分基准…
					</Text>
				</Group>
			) : loadError || !review || !rawDims ? (
				<Stack gap="sm" py="md">
					<Alert variant="light" color="red" icon={<IconAlertTriangle size={16} />}>
						<Text size="sm">
							{loadError ? "复核基准读取失败，无法编辑原始条目。" : "该评分没有可编辑的条目层（可能尚未评分）。"}
						</Text>
					</Alert>
					<Group justify="flex-end" gap="xs">
						<Button variant="outline" onClick={onClose}>
							关闭
						</Button>
						<Button onClick={onReload}>重新读取</Button>
					</Group>
				</Stack>
			) : (
				<Box>
					<Group gap="xs" wrap="wrap">
						<Badge variant="light" color="gray">
							原始量尺 0–{rawScale}
						</Badge>
						{applicableRawMax !== null && (
							<Badge variant="light" color="gray">
								适用原始满分 {applicableRawMax}
							</Badge>
						)}
						<Badge variant="light" color={review.review_status === "reviewed" ? "green" : "gray"}>
							{review.review_status === "reviewed" ? "已复核" : "未复核"}
						</Badge>
						{review.reviewed_by_name && (
							<Text size="xs" c="dimmed">
								上次复核：{review.reviewed_by_name}
							</Text>
						)}
					</Group>

					<Text size="xs" c="dimmed" mt="xs">
						逐项审核 AI 的原始条目判定；不改条目直接提交时总分不变。展示总分由服务端按同一映射换算（当前满分 {scoreMax}）。
					</Text>

					{basisNotice && (
						<Alert
							variant="light"
							color="yellow"
							icon={<IconAlertTriangle size={16} />}
							title="复核基准不是原始量尺"
							mt="sm"
						>
							<Text size="xs">{basisNotice}</Text>
						</Alert>
					)}

					<Box mt="md">
						{Object.entries(rawDims).map(([catName, catData]) => (
							<Box key={catName} mb="lg">
								<Group gap="xs" mb={6} wrap="nowrap">
									<Text size="xs" fw={600} c="dimmed" tt="uppercase">
										{catName}
									</Text>
									<Badge variant="light" color="gray">
										{catData.score}/{catData.max}
									</Badge>
									<Text size="11px" c="dimmed">
										原始分
									</Text>
								</Group>
								{(catData.items ?? []).map((item) => {
									// 病例声明不适用的条目可能来自 not_applicable_items（而非条目 status）：
									// 在渲染前归一成 not_applicable，UI 与提交载荷就只有一个判据
									const notApplicable =
										item.status === "not_applicable" ||
										notApplicableItems.includes(String(item.id));
									return (
										<ReviewItem
											key={String(item.id)}
											item={
												notApplicable
													? { ...item, status: "not_applicable", score: null }
													: item
											}
											rawScale={rawScale}
											notApplicable={notApplicable}
											editedScore={editedScores[String(item.id)]}
											onChange={handleScoreChange}
										/>
									);
								})}
							</Box>
						))}

						<Box mt="md">
							<Text component="label" size="sm" fw={600} mb={6} display="block">
								复核备注
							</Text>
							<Textarea
								value={comment}
								onChange={(e) => setComment(e.target.value)}
								placeholder="可选：对评分调整的说明..."
								rows={3}
							/>
						</Box>
					</Box>

					<Group justify="space-between" gap="xs" mt="lg" wrap="wrap">
						<Text size="xs" c="dimmed">
							原始分合计 {rawTotal}
							{applicableRawMax !== null ? ` / ${applicableRawMax}` : ""}，展示总分提交后由服务端换算
						</Text>
						<Group gap="xs">
							<Button variant="outline" onClick={onClose} disabled={submitting}>
								取消
							</Button>
							<Button onClick={handleSubmit} disabled={submitting}>
								{submitting ? "提交中..." : "提交复核"}
							</Button>
						</Group>
					</Group>
				</Box>
			)}
		</Modal>
	);
}
