import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiErrorDetail, getApiErrorMessage } from "@/utils/error";
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
		expect(getApiErrorMessage(err)).toBe("username: 不能为空；password: 至少6位");
	});

	it("drops body from loc paths", () => {
		const err = {
			response: { data: { detail: [{ loc: ["body"], msg: "整体错误" }] } },
		};
		expect(getApiErrorMessage(err)).toBe("整体错误");
	});

	it("英文的框架 message 不再原样露给学生（没有服务端文案就回退到人话）", () => {
		const err = { message: "Network Error" };
		expect(getApiErrorMessage(err)).toBe("操作失败");
		expect(getApiErrorMessage(err, "提交失败")).toBe("提交失败");
	});

	it("被序列化过的 JSON detail 不当文案用：能解出 message 就用它，解不出就按状态给人话", () => {
		const wrapped = {
			response: { status: 422, data: { detail: '{"detail":"包结构不合法"}' } },
		};
		expect(getApiErrorMessage(wrapped)).toBe("包结构不合法");

		const rawJson = {
			response: { status: 422, data: { detail: '{"problems":["缺少 key"]}' } },
		};
		expect(getApiErrorMessage(rawJson)).toBe("提交的内容不合法，请检查后重试");
	});

	it("拿不到文案时按状态码给人话（学生面认得出发生了什么）", () => {
		const byStatus = (status: number) =>
			getApiErrorMessage({ response: { status, data: {} } });
		expect(byStatus(404)).toContain("没有找到");
		expect(byStatus(403)).toBe("没有访问权限");
		expect(byStatus(401)).toBe("登录状态已失效，请重新登录");
		expect(byStatus(409)).toContain("冲突");
		expect(byStatus(422)).toContain("不合法");
		expect(byStatus(500)).toContain("服务端出错");
	});

	it("离线（网络中断）给人话而不是浏览器原文", () => {
		expect(getApiErrorMessage({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" })).toBe(
			"网络已断开，请检查连接后重试",
		);
	});

	it("校验明细走管理侧那个函数（人话 + 逐条 problems），学生侧那个不列明细", () => {
		const err = {
			response: {
				status: 422,
				data: {
					detail: {
						message: "包未通过校验",
						problems: ["缺少 key", "affordance 未定义", "state_keys 未知", "a", "b", "c"],
					},
				},
			},
		};
		expect(getApiErrorMessage(err)).toBe("包未通过校验");
		const detail = getApiErrorDetail(err);
		expect(detail).toContain("包未通过校验：缺少 key；affordance 未定义");
		// 上限之后省略，不把整页明细灌进 toast
		expect(detail.endsWith("；…")).toBe(true);
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
