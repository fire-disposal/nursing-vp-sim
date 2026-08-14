import { Box, Paper } from "@mantine/core";
import type { ComponentType, ReactNode } from "react";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Pagination from "@/components/ui/pagination";
import { Table } from "@mantine/core";

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

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
	emptyIcon?: IconType;
	emptyTitle?: string;
	emptyDescription?: string;
	onRowClick?: (row: T, index: number) => void;
	stickyHeader?: boolean;
	total?: number;
	offset?: number;
	limit?: number;
	onOffsetChange?: (offset: number) => void;
	/** Omit the card chrome (border/bg/shadow) when nested inside an existing card. */
	bare?: boolean;
	className?: string;
}

/**
 * DataTable — 列驱动数据表格（管理端高频组件）。
 * 表头：品牌浅底 + 大写小号标签；行：hover 高亮；数据密度紧凑可扫读。
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
	bare,
	className,
}: DataTableProps<T>) {
	const getKey =
		rowKey ??
		((row: T, index: number) => {
			if (row && typeof row === "object" && "id" in row) {
				const id = (row as { id?: unknown }).id;
				if (typeof id === "string" || typeof id === "number") return id;
			}
			return index;
		});

	const getCellValue = (row: T, key: string) => {
		if (row && typeof row === "object" && key in row) return Reflect.get(row, key);
		return "";
	};

	const table = (
		<>
			<Table>
				<Table.Thead>
					<Table.Tr>
						{columns.map((col) => (
							<Table.Th
								key={col.key}
								className={col.headerClassName}
								style={{
									position: stickyHeader ? "sticky" : undefined,
									top: 0,
									zIndex: 10,
									background: "var(--mantine-color-gray-0)",
									color: "var(--mantine-color-dimmed)",
									textTransform: "uppercase",
									fontSize: "0.6875rem",
									fontWeight: 700,
									letterSpacing: "0.06em",
									borderBottom: "1px solid var(--mantine-color-default-border)",
									whiteSpace: "nowrap",
								}}
							>
								{col.header}
							</Table.Th>
						))}
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{rows.map((row, idx) => (
						<Table.Tr
							key={getKey(row, idx)}
							onClick={onRowClick ? () => onRowClick(row, idx) : undefined}
							onKeyDown={
								onRowClick
									? (event) => {
											if (event.key !== "Enter" && event.key !== " ") return;
											event.preventDefault();
											onRowClick(row, idx);
										}
									: undefined
							}
							tabIndex={onRowClick ? 0 : undefined}
							role={onRowClick ? "button" : undefined}
							style={
								onRowClick
									? { cursor: "pointer" }
									: undefined
							}
							className="data-table-row"
						>
							{columns.map((col) => (
								<Table.Td key={col.key} className={col.cellClassName}>
									{col.render ? col.render(row, idx) : String(getCellValue(row, col.key) ?? "")}
								</Table.Td>
							))}
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>
			{total != null && offset != null && limit != null && onOffsetChange && total > 0 && (
				<Box px="md" py="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
					<Pagination total={total} offset={offset} limit={limit} onChange={onOffsetChange} />
				</Box>
			)}
		</>
	);

	if (loading && rows.length === 0) {
		const body = <LoadingSkeleton variant="table" />;
		return bare ? (
			<Box className={className} p="md">
				{body}
			</Box>
		) : (
			<Paper withBorder radius="md" shadow="sm" p="md" className={className}>
				{body}
			</Paper>
		);
	}

	if (!loading && rows.length === 0) {
		const body = <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
		return bare ? (
			<Box className={className}>{body}</Box>
		) : (
			<Paper withBorder radius="md" shadow="sm" className={className}>
				{body}
			</Paper>
		);
	}

	return bare ? (
		<Box className={className}>{table}</Box>
	) : (
		<Paper withBorder radius="md" shadow="sm" style={{ overflow: "hidden" }} className={className}>
			{table}
		</Paper>
	);
}
