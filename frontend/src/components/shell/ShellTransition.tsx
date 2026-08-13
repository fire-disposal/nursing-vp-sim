import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * ShellTransition — 页面切换动画包装器
 *
 * 使用同步 crossfade，而不是 wait 模式的先退场后入场。
 * 旧页面和新页面短暂重叠，避免内容区出现空帧闪烁。
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
				style={{ willChange: "opacity, transform" }}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}
