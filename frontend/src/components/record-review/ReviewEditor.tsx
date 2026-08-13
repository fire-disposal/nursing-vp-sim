import { Box, Group, Modal, Text } from "@mantine/core";
import { useState } from "react";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";

import { Textarea } from "@/components/ui/textarea";
import type { DetailScoreCategory, ScoreData } from "@/types/score";
import ReviewItem from "./ReviewItem";

type ScoreReviewResponse = components["schemas"]["ScoreReviewResponse"];

interface ReviewEditorProps {
	score: ScoreData;
	review: ScoreReviewResponse | null;
	onSubmit: (
		modifiedScores: Record<string, DetailScoreCategory>,
		comment: string,
	) => void;
	onClose: () => void;
	submitting: boolean;
}

export default function ReviewEditor({
	score,
	review,
	onSubmit,
	onClose,
	submitting,
}: ReviewEditorProps) {
	const detailScores = score?.detail_scores || {};
	const [comment, setComment] = useState(review?.review_comment || "");
	const [editedScores, setEditedScores] = useState<Record<number, number>>(
		() => {
			const initial: Record<number, number> = {};
			for (const [, catData] of Object.entries(detailScores)) {
				if (catData && typeof catData === "object" && "items" in catData) {
					for (const item of catData.items || []) {
						initial[item.id!] = item.score;
					}
				}
			}
			return initial;
		},
	);

	const categories = Object.entries(detailScores);
	const isNewFormat =
		categories.length > 0 &&
		categories[0][1] &&
		typeof categories[0][1] === "object" &&
		"items" in categories[0][1];

	const handleScoreChange = (itemId: number, newScore: number) => {
		setEditedScores((prev) => ({ ...prev, [itemId]: newScore }));
	};

	const handleSubmit = () => {
		const modified = JSON.parse(JSON.stringify(detailScores)) as Record<
			string,
			DetailScoreCategory
		>;
		for (const [, catData] of Object.entries(modified)) {
			if (catData && typeof catData === "object" && "items" in catData) {
				let catTotal = 0;
				for (const item of catData.items || []) {
					if (editedScores[item.id!] !== undefined) {
						item.score = editedScores[item.id!];
					}
					catTotal += item.score;
				}
				catData.score = catTotal;
			}
		}
		onSubmit(modified, comment);
	};

	return (
		<Modal opened onClose={onClose} title="教师复核评分" size={640} centered withinPortal>
			<Text size="xs" c="dimmed">
				逐项审核 AI 评分，可修改每项分值
			</Text>

			<Box mt="md">
				{isNewFormat ? (
					categories.map(([catName, catData]) => (
						<Box key={catName} mb="lg">
							<Group gap="xs" mb={6} wrap="nowrap">
								<Text size="xs" fw={600} c="dimmed" tt="uppercase">
									{catName}
								</Text>
								<Badge variant="neutral">
									{catData.score}/{catData.max}
								</Badge>
							</Group>
							{(catData.items || []).map((item) => (
								<ReviewItem
									key={item.id!}
									item={item}
									editedScore={editedScores[item.id!]}
									onChange={handleScoreChange}
								/>
							))}
						</Box>
					))
				) : (
					<Box
						py="lg"
						ta="center"
						style={{
							border: "1px dashed var(--mantine-color-gray-4)",
							borderRadius: "var(--mantine-radius-md)",
						}}
					>
						<Text size="sm" c="dimmed">
							此评分为旧版格式，不支持逐项修改。如需复核，请重新触发评分。
						</Text>
					</Box>
				)}

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

				<Group justify="flex-end" gap="xs" mt="lg">
					<Button variant="outline" onClick={onClose} disabled={submitting}>
						取消
					</Button>
					<Button onClick={handleSubmit} disabled={submitting}>
						{submitting ? "提交中..." : "提交复核"}
					</Button>
				</Group>
			</Box>
		</Modal>
	);
}
