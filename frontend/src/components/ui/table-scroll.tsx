import { Box } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";

interface TableScrollProps {
	children: ReactNode;
	/**
	 * 表格最小宽度（px）。视口窄于此值时表格不再被压扁，改为在容器内横滑。
	 * 取值按列数与列内容给 —— 这是每张表自己的信息，容器不替它猜。
	 */
	minWidth: number;
	/** 纵向限高（px）：表头在纵向滚动里吸顶，且不额外产生页面级第二条纵向滚动条。 */
	maxHeight?: number;
	className?: string;
	style?: CSSProperties;
}

/**
 * TableScroll — 全站表格的横向滚动容器（唯一实现）。
 *
 * 只做两件事：外层负责滚动（样式全在 `styles/global.css` 的 `.table-scroll`），
 * 内层负责最小宽度。之所以要内层：`min-width` 加在外层滚动容器上不起作用，
 * 必须给被滚动的内容本身。
 *
 * 不提供"是否可滑"的 JS 状态：两端阴影由 CSS 背景分层给出（见 global.css 注释）。
 */
export default function TableScroll({ children, minWidth, maxHeight, className, style }: TableScrollProps) {
	return (
		<Box className={className ? `table-scroll ${className}` : "table-scroll"} style={maxHeight ? { maxHeight, ...style } : style}>
			<div className="table-scroll-inner" style={{ minWidth }}>
				{children}
			</div>
		</Box>
	);
}
