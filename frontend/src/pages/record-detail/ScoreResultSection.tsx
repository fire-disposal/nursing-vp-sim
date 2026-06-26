import {
	AlertTriangle,
	CheckCircle,
	Download,
	Edit3,
	Lightbulb,
	ShieldCheck,
	ThumbsDown,
	ThumbsUp,
	X,
} from "lucide-react";
import Badge from "@/components/ui/badge";
import { CollapsibleSection, ScoreItem } from "@/components/record-review";
import { cn } from "@/utils/cn";
import type { DetailScoreCategory, ScoreData } from "@/types/score";

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

export default function ScoreResultSection({
	recordScore,
	isReviewed,
	review,
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
	return (
		<div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-5">
			<div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
				<div className="flex items-center gap-2.5 flex-wrap">
					<h3 className="text-base font-semibold">评分结果</h3>
					{isReviewed ? (
						<Badge variant="success">
							<ShieldCheck size={12} /> 教师已复核
						</Badge>
					) : (
						<Badge variant="info">AI 初评</Badge>
					)}
					{isReviewed && review?.reviewed_by_name && (
						<span className="text-xs text-muted-foreground">
							复核人: {review.reviewed_by_name}
							{review.reviewed_at &&
								` · ${new Date(review.reviewed_at).toLocaleDateString("zh-CN")}`}
						</span>
					)}
				</div>
				<div className="flex flex-wrap gap-2">
					{isTeacher && (
						<button
							className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted hover:border-primary/50 transition-colors"
							onClick={onReviewClick}
						>
							<Edit3 size={14} /> {isReviewed ? "修改复核" : "复核评分"}
						</button>
					)}
					<button
						className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
						onClick={onDetailedScoreClick}
					>
						查看详细评分
					</button>
					<button
						className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted hover:border-primary/50 transition-colors"
						onClick={onExport}
					>
						<Download size={14} />
						导出记录
					</button>
				</div>
			</div>

			<div className="flex items-baseline gap-2">
				<span className="text-4xl font-extrabold text-primary">
					{recordScore.total_score}
				</span>
				<span className="text-base text-muted-foreground">
					/ {scoreMax} 分
				</span>
			</div>

			{isReviewed && review?.review_comment && (
				<div className="px-4 py-3 rounded-lg bg-muted/50 border border-border text-sm">
					<span className="font-semibold text-muted-foreground">
						复核备注：
					</span>
					<span>{review.review_comment}</span>
				</div>
			)}

			{hasDetailItems && (
				<div className="space-y-4 pt-2 border-t border-border">
					{categories.map(([catName, catData]) => {
						if (
							!Array.isArray(catData.items) ||
							catData.items.length === 0
						)
							return null;
						const pct =
							catData.max > 0
								? Math.round((catData.score / catData.max) * 100)
								: 0;
						return (
							<div key={catName} className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-sm font-semibold">{catName}</span>
									<span className="text-sm text-muted-foreground tabular-nums">
										{catData.score}/{catData.max}
									</span>
								</div>
								<div className="h-2 rounded-full bg-muted overflow-hidden">
									<div
										className={cn(
											"h-full rounded-full transition-all duration-700",
											pct >= 80
												? "bg-green-500"
												: pct >= 50
													? "bg-amber-500"
													: "bg-red-500",
										)}
										style={{ width: `${pct}%` }}
									/>
								</div>
								<div className="space-y-0.5 mt-2">
									{catData.items.map((item, i) => (
										<ScoreItem key={item.id || i} item={item} />
									))}
								</div>
							</div>
						);
					})}
				</div>
			)}

			<CollapsibleSection
				icon={<ThumbsUp size={16} className="text-green-500" />}
				title="表现较好"
				expanded={expanded.strengths}
				onToggle={() => onToggleExpand("strengths")}
			>
				{recordScore.strengths && recordScore.strengths.length > 0 ? (
					<ul className="space-y-1.5">
						{recordScore.strengths.map((s, i) => (
							<li
								key={i}
								className="flex items-start gap-2 text-sm text-muted-foreground"
							>
								<CheckCircle
									size={14}
									className="text-green-500 shrink-0 mt-0.5"
								/>
								<span>{s}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground/50 italic">
						AI 未生成此部分内容，可重新评分获取完整报告
					</p>
				)}
			</CollapsibleSection>

			<CollapsibleSection
				icon={<ThumbsDown size={16} className="text-amber-500" />}
				title="需要改善"
				expanded={expanded.weaknesses}
				onToggle={() => onToggleExpand("weaknesses")}
			>
				{recordScore.weaknesses && recordScore.weaknesses.length > 0 ? (
					<ul className="space-y-1.5">
						{recordScore.weaknesses.map((w, i) => (
							<li
								key={i}
								className="flex items-start gap-2 text-sm text-muted-foreground"
							>
								<span className="size-3.5 rounded-full border-2 border-amber-400 shrink-0 mt-0.5" />
								<span>{w}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground/50 italic">
						AI 未生成此部分内容，可重新评分获取完整报告
					</p>
				)}
			</CollapsibleSection>

			<CollapsibleSection
				icon={<AlertTriangle size={16} className="text-red-500" />}
				title="漏问内容"
				expanded={expanded.missed_content}
				onToggle={() => onToggleExpand("missed_content")}
			>
				{recordScore.missed_content && recordScore.missed_content.length > 0 ? (
					<ul className="space-y-1.5">
						{recordScore.missed_content.map((m, i) => (
							<li
								key={i}
								className="flex items-start gap-2 text-sm text-muted-foreground"
							>
								<X
									size={14}
									className="text-red-400 shrink-0 mt-0.5"
								/>
								<span>{m}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground/50 italic">
						AI 未生成此部分内容，可重新评分获取完整报告
					</p>
				)}
			</CollapsibleSection>

			<CollapsibleSection
				icon={<Lightbulb size={16} className="text-blue-500" />}
				title="改进建议"
				expanded={expanded.suggestions}
				onToggle={() => onToggleExpand("suggestions")}
			>
				{recordScore.suggestions ? (
					<p className="text-sm text-muted-foreground leading-relaxed">
						{recordScore.suggestions}
					</p>
				) : (
					<p className="text-sm text-muted-foreground/50 italic">
						AI 未生成改进建议，可重新评分获取完整报告
					</p>
				)}
			</CollapsibleSection>
		</div>
	);
}
