import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChunkRecovery } from "@/utils/chunk-recovery";

/** Chrome 拦截 chunk 时的真实拒绝报文（/assets/Login-*.js 被阻断场景）。 */
const CHUNK_MSG =
	"Failed to fetch dynamically imported module: http://localhost:3000/assets/Login-abc123.js";

function addEntryScript(src: string): HTMLScriptElement {
	const script = document.createElement("script");
	script.type = "module";
	script.src = src;
	document.head.appendChild(script);
	return script;
}

/** 派发 Vite 预加载失败事件；返回 false 表示监听器 preventDefault（吞掉了错误）。 */
function dispatchPreloadError(payload: unknown): boolean {
	return window.dispatchEvent(
		Object.assign(new Event("vite:preloadError", { cancelable: true }), {
			payload,
		}),
	);
}

function dispatchRejection(reason: unknown): void {
	window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason }));
}

let reload: Mock<() => void>;
let installs: Array<() => void>;

/** 模拟一次页面加载：注册监听，返回该页面的卸载函数。 */
function boot(): () => void {
	const dispose = installChunkRecovery(reload);
	installs.push(dispose);
	return dispose;
}

beforeEach(() => {
	sessionStorage.clear();
	for (const script of document.querySelectorAll('script[type="module"][src]')) {
		script.remove();
	}
	reload = vi.fn<() => void>();
	installs = [];
});

afterEach(() => {
	for (const dispose of installs) dispose();
	vi.restoreAllMocks();
});

describe("chunk 加载失败的有界自恢复", () => {
	it("同一构建刷新后仍失败：不再自动刷新（停在可见错误，等用户手动恢复）", () => {
		addEntryScript("/assets/index-build-a.js");
		const firstPage = boot();
		dispatchPreloadError(new TypeError(CHUNK_MSG));
		expect(reload).toHaveBeenCalledTimes(1);

		// 刷新后是同一构建：新页面加载（sessionStorage 保留），chunk 仍被阻断
		firstPage();
		boot();
		const notPrevented = dispatchPreloadError(new TypeError(CHUNK_MSG));
		dispatchRejection(new TypeError(CHUNK_MSG));

		expect(reload).toHaveBeenCalledTimes(1);
		expect(notPrevented).toBe(true);
	});

	it("接口风格的 Failed to fetch / Network Error 不刷新页面", () => {
		addEntryScript("/assets/index-build-a.js");
		boot();

		dispatchRejection(new TypeError("Failed to fetch"));
		dispatchRejection(new TypeError("Network Error"));
		dispatchRejection(
			new TypeError("Failed to fetch http://localhost:8000/api/training/cases"),
		);

		expect(reload).not.toHaveBeenCalled();
	});

	it("Firefox / Safari / Vite CSS 预加载的失败报文同样被识别", () => {
		addEntryScript("/assets/index-build-a.js");
		boot();

		const messages = [
			"error loading dynamically imported module: http://localhost:3000/assets/Login-a.js",
			"Importing a module script failed.",
			"Unable to preload CSS for /assets/Login-a.css",
		];
		for (const message of messages) {
			sessionStorage.clear(); // 每个报文按独立标签页额度验证
			reload.mockClear();
			dispatchRejection(new TypeError(message));
			expect(reload, message).toHaveBeenCalledTimes(1);
		}
	});

	it("sessionStorage 读取被拒绝时不自动刷新（避免无界循环）", () => {
		addEntryScript("/assets/index-build-a.js");
		boot();
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("SecurityError: storage denied");
		});

		const notPrevented = dispatchPreloadError(new TypeError(CHUNK_MSG));

		expect(reload).not.toHaveBeenCalled();
		expect(notPrevented).toBe(true);
	});

	it("sessionStorage 写入未生效（抛异常或静默失败）时不自动刷新", () => {
		addEntryScript("/assets/index-build-a.js");
		boot();

		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("QuotaExceededError");
		});
		expect(dispatchPreloadError(new TypeError(CHUNK_MSG))).toBe(true);
		expect(reload).not.toHaveBeenCalled();

		// 隐私模式下写入静默失败：回读校验必须同样拦住自动刷新
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
		dispatchPreloadError(new TypeError(CHUNK_MSG));
		expect(reload).not.toHaveBeenCalled();
	});

	it("新构建（入口 script hash 变化）重新获得一次自动刷新额度", () => {
		const entry = addEntryScript("/assets/index-build-a.js");
		const firstPage = boot();
		dispatchPreloadError(new TypeError(CHUNK_MSG));
		expect(reload).toHaveBeenCalledTimes(1);
		firstPage();

		// 重新部署：新 index.html 指向新 hash 的入口脚本
		entry.src = "/assets/index-build-b.js";
		boot();
		dispatchPreloadError(new TypeError(CHUNK_MSG));

		expect(reload).toHaveBeenCalledTimes(2);
	});

	it("卸载监听后不再响应 chunk 失败", () => {
		addEntryScript("/assets/index-build-a.js");
		const dispose = boot();
		dispose();

		dispatchPreloadError(new TypeError(CHUNK_MSG));
		dispatchRejection(new TypeError(CHUNK_MSG));

		expect(reload).not.toHaveBeenCalled();
	});
});
