import "@testing-library/jest-dom/vitest";

/**
 * matchMedia 替身：**按 window.innerWidth/innerHeight 真求值**（不是一律 false）。
 *
 * 一律 false 会让"按方向/宽度分支"的界面在测试里永远走同一支路，把横竖屏这类缺陷藏起来
 * （2026-09-27 横屏误弹底部抽屉就是这种隐藏）。支持本仓实际使用的几种查询，其余查询返回 false
 * （与旧行为一致）。改视口用 `setViewport(宽, 高)`。
 */
export function setViewport(width: number, height: number): void {
	Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
	Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: height });
	window.dispatchEvent(new Event("resize"));
}

function evaluateMediaQuery(query: string, width: number, height: number): boolean {
	const checks = query.match(/\(([^)]+)\)/g) ?? [];
	if (checks.length === 0) return false;
	return checks.every((raw) => {
		const body = raw.slice(1, -1).trim();
		const minWidth = /\(min-width:\s*(\d+)px\)/.exec(`(${body})`);
		if (minWidth) return width >= Number(minWidth[1]);
		const maxWidth = /\(max-width:\s*(\d+)px\)/.exec(`(${body})`);
		if (maxWidth) return width <= Number(maxWidth[1]);
		const minHeight = /\(min-height:\s*(\d+)px\)/.exec(`(${body})`);
		if (minHeight) return height >= Number(minHeight[1]);
		const maxHeight = /\(max-height:\s*(\d+)px\)/.exec(`(${body})`);
		if (maxHeight) return height <= Number(maxHeight[1]);
		if (body === "orientation: landscape") return width > height;
		if (body === "orientation: portrait") return height >= width;
		return false;
	});
}

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: (query: string) => ({
		get matches() {
			return evaluateMediaQuery(query, window.innerWidth, window.innerHeight);
		},
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	}),
});

// jsdom 未实现 ResizeObserver（Mantine ScrollArea/Select 需要）
class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// jsdom 未实现 scrollIntoView（CaseSelector 的列表定位需要）
if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}

// Mantine 过渡/弹层依赖 requestAnimationFrame（jsdom 无 pretendToBeVisual 时不提供）
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

// jsdom 未实现 document.fonts（Mantine Autosize Textarea 需要）
if (!document.fonts) {
	Object.defineProperty(document, "fonts", {
		value: {
			addEventListener: () => {},
			removeEventListener: () => {},
			add: () => {},
			delete: () => {},
			clear: () => {},
			forEach: () => {},
			load: () => Promise.resolve([]),
			ready: Promise.resolve({}),
			status: "loaded",
		},
		configurable: true,
	});
}
