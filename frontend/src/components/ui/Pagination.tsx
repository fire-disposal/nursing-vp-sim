import { cn } from "@/lib/utils";

interface PaginationProps {
  total: number;
  offset: number;
  limit: number;
  onChange: (newOffset: number) => void;
  className?: string;
}

export default function Pagination({ total, offset, limit, onChange, className }: PaginationProps) {
  const currentStart = total === 0 ? 0 : offset + 1;
  const currentEnd = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <div className={cn("flex items-center justify-between text-sm text-muted-foreground", className)}>
      <span>
        第 {currentStart}-{currentEnd} 条，共 {total} 条
      </span>
      <div className="flex gap-2">
        <button
          className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          disabled={!hasPrev}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          上一页
        </button>
        <button
          className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          disabled={!hasNext}
          onClick={() => onChange(offset + limit)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
