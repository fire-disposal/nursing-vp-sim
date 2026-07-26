import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * ShellTransition — 页面切换动画包装器
 *
 * 根据当前路径作为 key，实现跨路由的 fade+slide 过渡。
 * 仅在非 reduced-motion 环境下执行（由 App.tsx 中的 MotionConfig 控制）。
 */
export default function ShellTransition({ children }: { children: ReactNode }) {
	const { pathname } = useLocation();
	return (
		<AnimatePresence mode="wait">
			<motion.div
				key={pathname}
				initial={{ opacity: 0, y: 6 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -4 }}
				transition={{ duration: 0.15, ease: "easeOut" }}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}
