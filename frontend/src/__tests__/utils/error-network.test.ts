import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiErrorMessage } from "@/utils/error";
import { waitForOnline } from "@/utils/network";

describe("getApiErrorMessage", () => {
	it("returns string detail from response", () => {
		const err = { response: { data: { detail: "用户名已存在" } } };
		expect(getApiErrorMessage(err)).toBe("用户名已存在");
	});

	it("formats array detail with field paths", () => {
		const err = {
			response: {
				data: {
					detail: [
						{ loc: ["body", "username"], msg: "不能为空" },
						{ loc: ["body", "password"], msg: "至少6位" },
					],
				},
			},
		};
		expect(getApiErrorMessage(err)).toBe("username: 不能为空; password: 至少6位");
	});

	it("drops body from loc paths", () => {
		const err = {
			response: { data: { detail: [{ loc: ["body"], msg: "整体错误" }] } },
		};
		expect(getApiErrorMessage(err)).toBe("整体错误");
	});

	it("falls back to message when no response detail", () => {
		const err = { message: "Network Error" };
		expect(getApiErrorMessage(err)).toBe("Network Error");
	});

	it("uses fallback for unknown shapes", () => {
		expect(getApiErrorMessage("oops")).toBe("操作失败");
		expect(getApiErrorMessage({})).toBe("操作失败");
		expect(getApiErrorMessage(null)).toBe("操作失败");
		expect(getApiErrorMessage(undefined)).toBe("操作失败");
	});

	it("custom fallback respected", () => {
		expect(getApiErrorMessage("x", "自定义")).toBe("自定义");
	});
});

describe("waitForOnline", () => {
	const originalOnLine = window.navigator.onLine;

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		Object.defineProperty(window.navigator, "onLine", { value: originalOnLine, configurable: true });
	});

	it("resolves immediately when already online", async () => {
		Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
		await expect(waitForOnline()).resolves.toBeUndefined();
	});

	it("resolves when online event fires", async () => {
		Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
		const promise = waitForOnline(1000);
		window.dispatchEvent(new Event("online"));
		await expect(promise).resolves.toBeUndefined();
	});

	it("rejects after timeout", async () => {
		vi.useFakeTimers();
		Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
		const promise = waitForOnline(100);
		vi.advanceTimersByTime(100);
		await expect(promise).rejects.toThrow("等待网络恢复超时");
	});

	it("cleans up listener after online", async () => {
		Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
		const promise = waitForOnline(1000);
		window.dispatchEvent(new Event("online"));
		await promise;
		// listener removed — second dispatch must not throw or re-resolve anything
		expect(() => window.dispatchEvent(new Event("online"))).not.toThrow();
	});
});
