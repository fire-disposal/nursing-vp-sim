import { useEffect, useState } from "react";

import { useMediaQuery } from "./useMediaQuery";

export type LayoutMode = "desktop" | "phone";

const MOBILE_BP = 768;

/** `lg`（Mantine 1200px）：在此宽度以上，右侧栏恒可用。 */
const RAIL_BP_PX = 1200;

function getMode(w: number): LayoutMode {
	return w < MOBILE_BP ? "phone" : "desktop";
}

export function useLayoutMode(): LayoutMode {
	const [mode, setMode] = useState<LayoutMode>(() =>
		typeof window === "undefined" ? "desktop" : getMode(window.innerWidth),
	);

	useEffect(() => {
		const onResize = () => setMode(getMode(window.innerWidth));
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	return mode;
}

export function useIsMobile(): boolean {
	const mode = useLayoutMode();
	return mode !== "desktop";
}

/** 工作区宿主：右侧栏 vs 底部抽屉。 */
export type WorkspaceHost = "rail" | "sheet";

/**
 * 选哪个宿主承载 Activity 面板 —— **按方向判定，不只是宽度**。
 *
 * 历史缺陷：底部抽屉只按"宽度 < lg"触发，于是**横屏**（宽不够 lg、但横向明明有位置、
 * 右侧栏可用）也会弹底部抽屉，把本来就不高的视口再切掉一半。抽屉是给手机**竖屏**准备的。
 *
 * 规则：
 * - 宽度 ≥ lg（1200px）：右侧栏；
 * - 竖屏（portrait）：底部抽屉；
 * - 其余（横屏，含横屏手机/平板/窄窗口）：右侧栏。
 */
export function useWorkspaceHost(): WorkspaceHost {
	const wide = useMediaQuery(`(min-width: ${RAIL_BP_PX}px)`);
	const portrait = useMediaQuery("(orientation: portrait)");
	if (wide) return "rail";
	return portrait ? "sheet" : "rail";
}
