import type { ReactNode } from "react";
import DataTable from "@/components/ui/data-table";
import Pagination from "@/components/ui/pagination";
import type { DataTableProps } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

export interface ResponsiveTableProps<T> extends DataTableProps<T> {
	/** Card rendering for mobile. Receives row + 0-based index. */
	renderCard: (row: T, index: number) => ReactNode;
	/** Override the card wrapper class. Default: space-y-2 p-2 */
	cardListClassName?: string;
}

/**
 * DataTable with built-in mobile card-list fallback.
 * Desktop (>=768px): renders DataTable as-is.
 * Mobile (<768px): renders cards via renderCard in a vertical list.
 *
 * Preserves all DataTable features: loading, empty, pagination, bare mode.
 */
export default function ResponsiveTable<T>({
	renderCard,
	cardListClassName,
	rows,
	loading,
	bare,
	className,
	total,
	offset,
	limit,
	onOffsetChange,
	rowKey,
	...dataTableProps
}: ResponsiveTableProps<T>) {
	const getKey =
		rowKey ??
		((row: T, index: number) => {
			if (row && typeof row === "object" && "id" in row) {
				const id = row.id;
				if (typeof id === "string" || typeof id === "number") return id;
			}
			return index;
		});

	const mobileList = (
		<div className={cn("space-y-2 p-2", cardListClassName)}>
			{rows.map((row, i) => (
				<div key={getKey(row, i)}>{renderCard(row, i)}</div>
			))}
		</div>
	);
	const mobilePagination =
		total != null && offset != null && limit != null && onOffsetChange && total > 0 ? (
			<div className="border-t border-border px-3 py-3 md:hidden">
				<Pagination
					total={total}
					offset={offset}
					limit={limit}
					onChange={onOffsetChange}
				/>
			</div>
		) : null;

	const loadingFallback = (
		<div className={cn("space-y-2 p-2 md:hidden", cardListClassName)}>
			{[0, 1, 2].map((i) => (
				<div key={i} className="rounded-lg border bg-card p-3 animate-pulse">
					<div className="h-4 w-2/3 bg-muted rounded mb-2" />
					<div className="h-3 w-1/2 bg-muted rounded" />
				</div>
			))}
		</div>
	);

	if (loading && rows.length === 0) {
		return (
			<div className={cn(!bare && "rounded-xl border border-border bg-card shadow-e1 overflow-hidden", className)}>
				<div className="hidden md:block">
					<DataTable<T> rows={rows} loading={loading} bare rowKey={rowKey} total={total} offset={offset} limit={limit} onOffsetChange={onOffsetChange} {...dataTableProps} />
				</div>
				{loadingFallback}
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<DataTable<T> rows={rows} loading={loading} bare={bare} className={className} rowKey={rowKey} total={total} offset={offset} limit={limit} onOffsetChange={onOffsetChange} {...dataTableProps} />
		);
	}

	return (
		<div className={cn(!bare && "rounded-xl border border-border bg-card shadow-e1 overflow-hidden", className)}>
			<div className="hidden md:block">
				<DataTable<T> rows={rows} loading={loading} bare rowKey={rowKey} total={total} offset={offset} limit={limit} onOffsetChange={onOffsetChange} {...dataTableProps} />
			</div>
			<div className="md:hidden">{mobileList}{mobilePagination}</div>
		</div>
	);
}
