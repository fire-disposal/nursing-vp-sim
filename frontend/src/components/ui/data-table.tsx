import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Pagination from "@/components/ui/pagination";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
	key: string;
	header: string;
	render?: (row: T, index: number) => ReactNode;
	headerClassName?: string;
	cellClassName?: string;
}

export interface DataTableProps<T> {
	columns: DataTableColumn<T>[];
	rows: T[];
	rowKey?: (row: T) => string | number;
	loading?: boolean;
	emptyIcon?: LucideIcon;
	emptyTitle?: string;
	emptyDescription?: string;
	onRowClick?: (row: T, index: number) => void;
	stickyHeader?: boolean;
	total?: number;
	offset?: number;
	limit?: number;
	onOffsetChange?: (offset: number) => void;
	className?: string;
}

/**
 * Column-defined table built on the shared `ui/table` primitives.
 * Handles loading / empty states and optional pagination.
 *
 * NOTE: when `onRowClick` is set, any interactive element inside a column
 * `render` (edit/delete buttons) MUST call `e.stopPropagation()`.
 */
export default function DataTable<T>({
	columns,
	rows,
	rowKey,
	loading,
	emptyIcon,
	emptyTitle = "暂无数据",
	emptyDescription,
	onRowClick,
	stickyHeader = true,
	total,
	offset,
	limit,
	onOffsetChange,
	className,
}: DataTableProps<T>) {
	const wrapper = cn(
		"rounded-xl border border-border bg-card shadow-sm overflow-hidden",
		className,
	);

	if (loading && rows.length === 0) {
		return (
			<div className={cn(wrapper, "p-6")}>
				<LoadingSkeleton variant="table" />
			</div>
		);
	}

	if (!loading && rows.length === 0) {
		return (
			<div className={wrapper}>
				<EmptyState
					icon={emptyIcon}
					title={emptyTitle}
					description={emptyDescription}
				/>
			</div>
		);
	}

	const getKey =
		rowKey ??
		((row: T, index: number) =>
			(row as { id?: string | number }).id ?? index);

	const headerClass = cn(
		"px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider",
		stickyHeader && "sticky top-0 z-10",
	);

	return (
		<div className={wrapper}>
			<Table>
				<TableHeader>
					<TableRow>
						{columns.map((col) => (
							<TableHead
								key={col.key}
								className={cn(headerClass, col.headerClassName)}
							>
								{col.header}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row, idx) => (
						<TableRow
							key={getKey(row, idx)}
							className={cn(onRowClick && "cursor-pointer")}
							onClick={onRowClick ? () => onRowClick(row, idx) : undefined}
						>
							{columns.map((col) => (
								<TableCell
									key={col.key}
									className={cn("px-4 py-3", col.cellClassName)}
								>
									{col.render
										? col.render(row, idx)
										: String((row as Record<string, unknown>)[col.key] ?? "")}
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
			{total != null &&
				offset != null &&
				limit != null &&
				onOffsetChange &&
				total > 0 && (
					<div className="border-t border-border px-4 py-3">
						<Pagination
							total={total}
							offset={offset}
							limit={limit}
							onChange={onOffsetChange}
						/>
					</div>
				)}
		</div>
	);
}
