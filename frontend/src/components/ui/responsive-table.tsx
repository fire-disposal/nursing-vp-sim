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
 *
 * 断点归属：本文件用 Mantine 的 `md` 断言（`visibleFrom` / `hiddenFrom`）做「表格 ↔ 卡片列表」的
 * 分界。Mantine 断点是 em 字符串（`md` = 62em），引不到 `@/config/layout-scale` 的 px 常量，
 * 所以对应关系靠这条注释钉住：`sm` = WIDTH.phoneShell (768px)，`md` = WIDTH.tableCompact (992px)。
 * 改常量时必须同时改这里用到的断点字母。
 *
 * Desktop (>=992px): renders DataTable as-is.
 * Compact (<992px): renders cards via renderCard in a vertical list.
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
				<Paper key={i} withBorder p="sm">
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
			<Paper withBorder shadow="sm" style={{ overflow: "hidden" }} className={className}>
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
