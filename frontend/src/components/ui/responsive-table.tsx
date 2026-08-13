import { Box, Paper, Skeleton, Stack } from "@mantine/core";
import type { ReactNode } from "react";
import DataTable from "@/components/ui/data-table";
import Pagination from "@/components/ui/pagination";
import type { DataTableProps } from "@/components/ui/data-table";

export interface ResponsiveTableProps<T> extends DataTableProps<T> {
	/** Card rendering for mobile. Receives row + 0-based index. */
	renderCard: (row: T, index: number) => ReactNode;
	/** Override the card wrapper class. */
	cardListClassName?: string;
}

/**
 * DataTable with built-in mobile card-list fallback.
 * Desktop (>=768px): renders DataTable as-is.
 * Mobile (<768px): renders cards via renderCard in a vertical list.
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
				const id = (row as { id?: unknown }).id;
				if (typeof id === "string" || typeof id === "number") return id;
			}
			return index;
		});

	const mobileList = (
		<Stack gap="xs" p="xs" className={cardListClassName}>
			{rows.map((row, i) => (
				<div key={getKey(row, i)}>{renderCard(row, i)}</div>
			))}
		</Stack>
	);

	const mobilePagination =
		total != null && offset != null && limit != null && onOffsetChange && total > 0 ? (
			<Box px="sm" py="sm" hiddenFrom="md" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
				<Pagination total={total} offset={offset} limit={limit} onChange={onOffsetChange} />
			</Box>
		) : null;

	const loadingFallback = (
		<Stack gap="xs" p="xs" hiddenFrom="md" className={cardListClassName}>
			{[0, 1, 2].map((i) => (
				<Paper key={i} withBorder radius="md" p="sm">
					<Skeleton height={16} width="66%" mb={8} />
					<Skeleton height={12} width="50%" />
				</Paper>
			))}
		</Stack>
	);

	const wrap = (inner: ReactNode) =>
		bare ? (
			<Box className={className}>{inner}</Box>
		) : (
			<Paper withBorder radius="md" shadow="sm" style={{ overflow: "hidden" }} className={className}>
				{inner}
			</Paper>
		);

	if (loading && rows.length === 0) {
		return wrap(
			<>
				<Box visibleFrom="md">
					<DataTable<T> rows={rows} loading={loading} bare rowKey={rowKey} total={total} offset={offset} limit={limit} onOffsetChange={onOffsetChange} {...dataTableProps} />
				</Box>
				{loadingFallback}
			</>,
		);
	}

	if (rows.length === 0) {
		return (
			<DataTable<T> rows={rows} loading={loading} bare={bare} className={className} rowKey={rowKey} total={total} offset={offset} limit={limit} onOffsetChange={onOffsetChange} {...dataTableProps} />
		);
	}

	return wrap(
		<>
			<Box visibleFrom="md">
				<DataTable<T> rows={rows} loading={loading} bare rowKey={rowKey} total={total} offset={offset} limit={limit} onOffsetChange={onOffsetChange} {...dataTableProps} />
			</Box>
			<Box hiddenFrom="md">
				{mobileList}
				{mobilePagination}
			</Box>
		</>,
	);
}
