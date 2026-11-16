/** 视口高度单位 + 留白探针。
 *
 * `dvh` 在 Chromium <108、Safari <15.4、以及部分内嵌 WebView / 兼容模式里不被支持：
 * 整条 `height: 100dvh` 会在解析期被丢弃，容器退化成内容高度，沉浸页底部露出一片白
 * （2026-11-16 线上截图，用户手上没有那台机器，只能靠遥测定罪）。
 *
 * 所以这里做两件事：
 *   1. 给出运行时可用的高度单位（不支持 dvh 就用 vh），供内联样式使用；
 *   2. 训练页挂载后量一次「根容器 vs 视口」，差得离谱就上报一次现场指标。
 * 探针本身永不抛错——它坏了也不该影响训练。
 */
import { reportError } from "@/utils/telemetry";

export function supportsDvh(): boolean {
	try {
		return typeof CSS !== "undefined" && CSS.supports("height", "100dvh");
	} catch {
		return false;
	}
}

/** 内联样式用的视口高度：不支持 dvh 时退回 100vh。 */
export const VIEWPORT_HEIGHT: string = supportsDvh() ? "100dvh" : "100vh";

const PROBE_KEY = "viewport-probe-sent";

/**
 * 训练页挂载后量一次：根容器明显矮于视口就上报。
 * 阈值 96px：正常实现下根容器应等于视口；小于 96 的差额多是边框/安全区，不值得记一条。
 */
export function probeViewportGap(el: HTMLElement | null): void {
	if (!el) return;
	try {
		if (sessionStorage.getItem(PROBE_KEY) === "1") return;
		const run = (): void => {
			const rootHeight = Math.round(el.getBoundingClientRect().height);
			const innerHeight = Math.round(window.innerHeight);
			const gap = innerHeight - rootHeight;
			if (gap < 96) return;
			sessionStorage.setItem(PROBE_KEY, "1");
			const vv = window.visualViewport;
			reportError(
				"ViewportGap",
				JSON.stringify({
					dvh: supportsDvh(),
					innerHeight,
					visualViewport: vv ? Math.round(vv.height) : null,
					rootHeight,
					gap,
					innerWidth: Math.round(window.innerWidth),
					dpr: window.devicePixelRatio,
					screen: `${screen.width}x${screen.height}`,
					docClientHeight: document.documentElement.clientHeight,
					outer: `${window.outerWidth}x${window.outerHeight}`,
				}),
				window.location.pathname,
				{ source: "training.viewport" },
			);
		};
		if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
		else window.setTimeout(run, 0);
	} catch {
		/* 探针失败不影响训练 */
	}
}
