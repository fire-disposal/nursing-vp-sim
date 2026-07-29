import { cn } from "@/lib/utils";

interface PaginationProps {
	total: number;
	offset: number;
	limit: number;
	onChange: (newOffset: number) => void;
	className?: string;
}

export default function Pagination({
	total,
	offset,
	limit,
	onChange,
	className,
}: PaginationProps) {
	const lastPageOffset = total > 0 ? Math.floor((total - 1) / limit) * limit : 0;
	const pageOffset = Math.min(Math.max(0, offset), lastPageOffset);
	const currentStart = total === 0 ? 0 : pageOffset + 1;
	const currentEnd = Math.min(pageOffset + limit, total);
	const hasPrev = pageOffset > 0;
	const hasNext = pageOffset + limit < total;

	return (
		<div
			className={cn(
				"flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
				className,
			)}
		>
			<span>
				第 {currentStart}-{currentEnd} 条，共 {total} 条
			</span>
			<div className="flex gap-2">
				<button
					className="inline-flex items-center justify-center rounded-lg border border-input focus-ring bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
					disabled={!hasPrev}
					aria-label="上一页"
					onClick={() => onChange(Math.max(0, pageOffset - limit))}
				>
					上一页
				</button>
				<button
					className="inline-flex items-center justify-center rounded-lg border border-input focus-ring bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
					disabled={!hasNext}
					aria-label="下一页"
					onClick={() => onChange(Math.min(lastPageOffset, pageOffset + limit))}
				>
					下一页
				</button>
			</div>
		</div>
	);
}
