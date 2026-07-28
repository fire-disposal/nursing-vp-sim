import { X } from "lucide-react";
import { useState } from "react";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/badge";
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
		<div
			className="fixed inset-0 bg-background/95 flex items-center justify-center z-[200]"
			onClick={onClose}
		>
			<div
				className="bg-card rounded-2xl p-6 sm:p-8 max-w-[640px] w-[94vw] max-h-[90vh] overflow-auto shadow-xl border border-border"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex justify-between items-center mb-5">
					<div>
						<h2 className="text-lg font-semibold">教师复核评分</h2>
						<span className="text-xs text-muted-foreground">
							逐项审核 AI 评分，可修改每项分值
						</span>
					</div>
					<button
						onClick={onClose}
						className="size-9 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
					>
						<X size={16} />
					</button>
				</div>

				{isNewFormat ? (
					categories.map(([catName, catData]) => (
						<div key={catName} className="mb-5">
							<div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
								<span>{catName}</span>
								<Badge variant="neutral">
									{catData.score}/{catData.max}
								</Badge>
							</div>
							{(catData.items || []).map((item) => (
								<ReviewItem
									key={item.id!}
									item={item}
									editedScore={editedScores[item.id!]}
									onChange={handleScoreChange}
								/>
							))}
						</div>
					))
				) : (
					<div className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border rounded-xl">
						此评分为旧版格式，不支持逐项修改。如需复核，请重新触发评分。
					</div>
				)}

				<div className="mt-4">
					<label className="text-sm font-semibold block mb-1.5">复核备注</label>
					<textarea
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						placeholder="可选：对评分调整的说明..."
						rows={3}
						className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm resize-y placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary"
					/>
				</div>

				<div className="flex justify-end gap-2 mt-5">
					<button
						className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						onClick={onClose}
						disabled={submitting}
					>
						取消
					</button>
					<button
						className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						onClick={handleSubmit}
						disabled={submitting}
					>
						{submitting ? "提交中..." : "提交复核"}
					</button>
				</div>
			</div>
		</div>
	);
}
