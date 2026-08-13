import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: (query: string) => ({
		matches: false,
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
