import { describe, expect, it } from "vitest";
import { supportsDvh, VIEWPORT_HEIGHT } from "@/utils/viewport";

/**
 * 兼容兜底的判据：JS 环境没有 dvh 支持时必须给 100vh。
 * 真实旧内核（Chromium <108 / Safari <15.4）在解析期丢弃 100dvh，靠这里退回。
 */
describe("视口高度兜底", () => {
	it("不支持 dvh 时退回 100vh", () => {
		expect(supportsDvh()).toBe(false);
		expect(VIEWPORT_HEIGHT).toBe("100vh");
	});
});
