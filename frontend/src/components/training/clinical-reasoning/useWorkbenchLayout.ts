import { useEffect, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { WIDTH } from "@/config/layout-scale";

/**
 * 工作台的**版式决策**集中在这里，场景与子组件共用同一份判断。
 *
 * 为什么不各自 `useMediaQuery`：三列 / 单列、顶栏退避、联结是否做平滑滚动，必须
 * 在同一次渲染里读到同一组值，否则会出现"列已切换成单列、滚动仍按三列算"的错位。
 */

/** 宽到能并排放下「证据 304 + 对话 + 行动 324」。 */
export function useWideWorkbench(): boolean {
	return useMediaQuery(`(min-width: ${WIDTH.rail}px)`);
}

/**
 * 系统「减弱动态」偏好。
 *
 * CSS 已经用 `@media (prefers-reduced-motion: reduce)` 兜住动画本身；这个 hook 管**行为**：
 * 减弱动态时不做平滑滚动（`behavior: "auto"`），否则"证据浮现"仍会让整页跳一下。
 */
export function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
		setReduced(query.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);
	return reduced;
}
