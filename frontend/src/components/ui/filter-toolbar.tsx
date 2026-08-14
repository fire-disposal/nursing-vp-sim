import { Button, Group, Paper, Text } from "@mantine/core";
import { IconFilterOff } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface FilterToolbarProps {
	/** 左侧说明/计数（如"共 128 条"） */
	summary?: ReactNode;
	/** 筛选控件插槽（Select/日期/Checkbox 等） */
	filters?: ReactNode;
	/** 搜索框（SearchInput） */
	search?: ReactNode;
	/** 有活跃筛选时显示"清除" */
	hasActiveFilters?: boolean;
	onClear?: () => void;
	/** 紧凑模式：用于嵌在卡片内的工具条 */
	compact?: boolean;
}

/**
 * FilterToolbar — 统一"搜索 + 筛选 + 清除"工具栏范式。
 * 布局：计数 | 筛选控件（自适应换行） | 搜索 + 清除（右对齐）。
 * 所有列表页筛选区收敛到同一交互：筛选有值时显示清除，一键复位。
 */
export function FilterToolbar({
	summary,
	filters,
	search,
	hasActiveFilters = false,
	onClear,
	compact,
}: FilterToolbarProps) {
	return (
		<Paper withBorder radius="md" p={compact ? "xs" : "sm"}>
			<Group gap="sm" align="center" wrap="wrap">
				{summary && (
					<Text size="xs" c="dimmed" className="tabular-nums">
						{summary}
					</Text>
				)}
				{filters && (
					<Group gap="xs" align="center" wrap="wrap">
						{filters}
					</Group>
				)}
				{search && (
					<Group gap="xs" align="center" wrap="nowrap" style={{ marginLeft: "auto" }}>
						{search}
						{hasActiveFilters && onClear && (
							<Button
								variant="subtle"
								color="gray"
								size={compact ? "xs" : "sm"}
								onClick={onClear}
								leftSection={<IconFilterOff size={14} />}
							>
								清除
							</Button>
						)}
					</Group>
				)}
			</Group>
		</Paper>
	);
}

export default FilterToolbar;
