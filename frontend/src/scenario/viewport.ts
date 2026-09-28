import { useEffect, useState } from "react";

/**
 * 窄屏断点：与 `scenario.css` 移动端一节（`@media (max-width: 760px)`）**同一个数**。
 *
 * 断点只有一处来源的说法是假的——CSS 里那份是媒体查询、这份是 JS；两边必须同时改。
 * 所以这个常量只给"必须在 JS 里换形态"的地方用（抽屉、页头尾部控件的形状），
 * 能靠 CSS 表达的形态一律留在 CSS 里（例如侧栏的常驻/浮层）。
 */
export const NARROW_QUERY = "(max-width: 760px)";

/**
 * 是否窄屏。默认值来自视口，之后跟着查询串与 resize 走（旋转、缩放都算）。
 *
 * 无 `matchMedia`（SSR / 老测试环境）时按**桌面**处理：页头的桌面形态是不依赖任何浮层的直给按钮，
 * 拿它当兜底比"先渲染抽屉入口再被媒体查询藏掉"更不容易出错。
 */
export function useNarrowScreen(query: string = NARROW_QUERY): boolean {
	const read = () =>
		typeof window === "undefined" || typeof window.matchMedia !== "function"
			? false
			: window.matchMedia(query).matches;
	const [narrow, setNarrow] = useState(read);
	useEffect(() => {
		const list = window.matchMedia?.(query);
		const update = () => setNarrow(read());
		// 两种信号都听：查询串自身的变化，以及旋转/缩放带来的 resize
		list?.addEventListener?.("change", update);
		window.addEventListener("resize", update);
		return () => {
			list?.removeEventListener?.("change", update);
			window.removeEventListener("resize", update);
		};
	}, [query]);
	return narrow;
}
