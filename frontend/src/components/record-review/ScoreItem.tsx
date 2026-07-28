import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import { useState } from "react";
import type { ScoreItemData } from "@/types/score";
import { cn } from "@/lib/utils";

export default function ScoreItem({ item }: { item: ScoreItemData }) {
	const itemMax = Number.isFinite(item.max) && item.max! > 0 ? item.max! : 3;
	const [expanded, setExpanded] = useState(item.score < itemMax * 0.6);
	const hasEvidence = item.evidence || item.reason;

	return (
		<div className="mb-1">
			<div
				onClick={() => hasEvidence && setExpanded(!expanded)}
				className={cn(
					"flex justify-between items-center px-3 py-2 rounded-lg transition-colors",
					hasEvidence ? "cursor-pointer hover:bg-muted/80" : "cursor-default",
					item.score >= itemMax
						? "bg-success"
						: item.score >= Math.ceil(itemMax * 0.6)
							? "bg-neutral"
							: "bg-danger",
				)}
			>
				<div className="flex items-center gap-1.5 flex-1 min-w-0">
					{hasEvidence && (
						<span className="text-muted-foreground shrink-0">
							{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
						</span>
					)}
					<span className="text-sm truncate">{item.name}</span>
				</div>
				<span
					className={cn(
						"text-sm font-bold ml-2 shrink-0",
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
			<div
				className={cn(
					"overflow-hidden transition-all duration-300",
					expanded && hasEvidence
						? "max-h-[300px] opacity-100 mt-1 ml-4"
						: "max-h-0 opacity-0",
				)}
			>
				<div className="p-3 rounded-lg bg-muted/30 border border-border text-sm leading-relaxed">
					{item.evidence && (
						<div className={item.reason ? "mb-2" : ""}>
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
			</div>
		</div>
	);
}
