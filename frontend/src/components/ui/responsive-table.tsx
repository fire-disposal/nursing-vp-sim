import type { ReactNode } from "react";
import DataTable from "@/components/ui/data-table";
import type { DataTableProps } from "@/components/ui/data-table";
import { cn } from "@/utils/cn";

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
	...dataTableProps
}: ResponsiveTableProps<T>) {
	const mobileList = (
		<div className={cn("space-y-2 p-2", cardListClassName)}>
			{rows.map((row, i) => (
				<div key={i}>{renderCard(row, i)}</div>
			))}
		</div>
	);

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
			<div className={cn(!bare && "rounded-xl border border-border bg-card shadow-sm overflow-hidden", className)}>
				<div className="hidden md:block">
					<DataTable<T> rows={rows} loading={loading} bare {...dataTableProps} />
				</div>
				{loadingFallback}
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<DataTable<T> rows={rows} loading={loading} bare={bare} className={className} {...dataTableProps} />
		);
	}

	return (
		<div className={cn(!bare && "rounded-xl border border-border bg-card shadow-sm overflow-hidden", className)}>
			<div className="hidden md:block">
				<DataTable<T> rows={rows} loading={loading} bare {...dataTableProps} />
			</div>
			<div className="md:hidden">{mobileList}</div>
		</div>
	);
}
