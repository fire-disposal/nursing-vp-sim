import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * ShellTransition — 页面切换动画包装器
 *
 * 使用同步 crossfade，而不是 wait 模式的先退场后入场。
 * 旧页面和新页面短暂重叠，避免内容区出现空帧闪烁。
 *
 * ⚠️ 不要在这个包裹层上加 `will-change`（或 `transform`/`filter`/`contain`/`perspective`）：
 * 这类属性会让本层成为 `position: fixed` 后代的**包含块**，页面内的悬浮元素（批量操作条、
 * 内嵌遮罩等）就会相对本层而不是视口定位 —— 2026-09-26 线上实测：用户管理勾选后
 * 批量条跑到列表底部视口外（barTop=2616px / 视口 884px），功能事实上不可用。
 * 需要合成层提示时请用只在过渡期间生效的 class，别写成常驻内联样式。
 */
export default function ShellTransition({ children }: { children: ReactNode }) {
	const { pathname } = useLocation();
	return (
		<AnimatePresence initial={false} mode="popLayout">
			<motion.div
				key={pathname}
				initial={{ opacity: 0, y: 2 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0 }}
				transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}
