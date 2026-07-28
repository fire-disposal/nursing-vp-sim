import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import { useState } from "react";
import type { ScoreItemData } from "@/types/score";
import { cn } from "@/lib/utils";

interface ReviewItemProps {
	item: ScoreItemData;
	editedScore?: number;
	onChange: (itemId: number, newScore: number) => void;
}

export default function ReviewItem({ item, editedScore, onChange }: ReviewItemProps) {
	const [expanded, setExpanded] = useState(false);
	const hasEvidence = item.evidence || item.reason;
	const currentScore = editedScore !== undefined ? editedScore : item.score;
	const itemMax = Number.isFinite(item.max) && item.max! > 0 ? item.max! : 3;
	const scoreOptions = Array.from({ length: itemMax }, (_, i) => i + 1);

	return (
		<div className="mb-2">
			<div className="flex justify-between items-center px-3 py-2.5 rounded-lg bg-muted/50 border border-border flex-wrap gap-2">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						<span className="text-sm font-medium">{item.name}</span>
						{hasEvidence && (
							<button
								onClick={() => setExpanded(!expanded)}
								className="border-0 bg-transparent p-0 text-muted-foreground flex hover:text-foreground transition-colors"
							>
								{expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
							</button>
						)}
					</div>
					<div className="flex items-center gap-1.5 mt-0.5">
						<span className="text-xs text-muted-foreground">AI 评分: </span>
						<span
							className={cn(
								"text-xs font-bold",
								item.score >= itemMax
									? "text-success-foreground"
									: item.score >= Math.ceil(itemMax * 0.6)
										? "text-neutral-foreground"
										: "text-danger-foreground",
							)}
						>
							{item.score}/{itemMax}
						</span>
					</div>
				</div>
				<div className="flex items-center gap-1.5">
					{scoreOptions.map((s) => (
						<button
							key={s}
							onClick={() => onChange(item.id!, s)}
							className={cn(
								"w-8 h-8 rounded-lg text-sm font-medium transition-all",
								currentScore === s
									? "border-2 border-primary bg-primary/10 text-primary"
									: "border border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
							)}
						>
							{s}
						</button>
					))}
				</div>
			</div>
			{expanded && hasEvidence && (
				<div className="ml-3 mt-2 px-3 py-2.5 rounded-lg bg-muted/30 border border-border text-xs leading-relaxed">
					{item.evidence && (
						<div className={cn(item.reason && "mb-2")}>
							<span className="font-semibold text-muted-foreground flex items-center gap-1 mb-0.5">
								<MessageSquare size={11} /> 证据
							</span>
							<span className="text-foreground/80">{item.evidence}</span>
						</div>
					)}
					{item.reason && (
						<div>
							<span className="font-semibold text-muted-foreground">
								理由：
							</span>
							<span className="text-foreground/80">{item.reason}</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
