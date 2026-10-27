import { Box, Paper } from "@mantine/core";
import type { ReactNode } from "react";

interface ListPageProps {
	/** 页头（PageHeader）：本页唯一主行动在这里。 */
	header: ReactNode;
	/** 筛选条（FilterToolbar）：吸顶，滚列表时始终可用。 */
	toolbar: ReactNode;
	/** 吸底（分页/批量摘要）；没有就不渲染。 */
	footer?: ReactNode;
	/** 列表本体（表格或卡片网格）。 */
	children: ReactNode;
	/** 表格型列表用 off（卡片自带留白，不再叠一层）。 */
	padded?: boolean;
}

/**
 * ListPage — 列表页的唯一骨架：页头 → 吸顶筛选 → 列表 → 吸底分页。
 *
 * 存在的理由：此前每个列表页自己决定「筛选区是不是一张 Paper、分页在列表里还是列表外、
 * 滚动区是谁」，于是 5 个列表页有 5 种呼吸节奏，翻页按钮的位置也不一样。
 * 这里只固定**位置**，不固定内容：筛选条里放什么仍由页面决定。
 *
 * 滚动仍交给文档（不用嵌套滚动容器）：嵌套滚动在手机上会和软键盘、底部 Tab 打架，
 * 而 sticky 已经足够让筛选/分页在滚动时可见。
 */
export default function ListPage({ header, toolbar, footer, children, padded = true }: ListPageProps) {
	return (
		<Box>
			{header}
			<Box
				style={{
					position: "sticky",
					top: 0,
					zIndex: 3,
					// 吸顶时列表从它下面穿过：用画布底色遮住，而不是半透明（半透明会让文字重叠）
					background: "var(--mantine-color-body)",
					paddingBottom: 8,
				}}
			>
				<Paper withBorder p="xs">
					{toolbar}
				</Paper>
			</Box>

			<Box mt="sm" pb={footer ? 64 : 0} style={padded ? undefined : { marginTop: 8 }}>
				{children}
			</Box>

			{footer && (
				<Box
					style={{
						position: "sticky",
						bottom: 0,
						zIndex: 3,
						background: "var(--mantine-color-body)",
						borderTop: "1px solid var(--mantine-color-default-border)",
						padding: "8px 4px",
					}}
				>
					{footer}
				</Box>
			)}
		</Box>
	);
}
