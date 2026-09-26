/**
 * 显示时区判据：**不论进程/浏览器时区，一律按上海展示**。
 *
 * 背景：后端以 UTC 存（timestamptz），受众在学校；2026-09-26 时区对齐
 * （见 docs/ops/timezone-alignment.md）。这里把测试进程时区设为 UTC，
 * 断言输出仍是上海时间 —— 若有人把 timeZone 选项去掉，本判据立刻失败。
 */
import { describe, expect, it } from "vitest";
import { APP_TIME_ZONE, formatDate, formatDateTime } from "@/utils/date";

describe("时间显示统一按上海时区", () => {
	it("常量就是 Asia/Shanghai", () => {
		expect(APP_TIME_ZONE).toBe("Asia/Shanghai");
	});

	it("UTC 13:05 渲染为上海 21:05（与进程时区无关）", () => {
		// 13:05Z = 21:05 +08
		const out = formatDateTime("2026-09-26T13:05:00Z");
		expect(out).toContain("21:05");
	});

	it("跨日边界：UTC 前一日 17:30 是上海次日 01:30", () => {
		const out = formatDateTime("2026-09-25T17:30:00Z");
		expect(out).toContain("01:30");
		expect(out).toContain("9/26");
	});

	it("仅日期也按上海：UTC 16:00 已是上海次日", () => {
		expect(formatDate("2026-09-25T16:00:00Z")).toBe("2026/9/26");
	});

	it("空值/非法值不抛错", () => {
		expect(formatDateTime(null)).toBe("");
		expect(formatDate("not-a-date")).toBe("");
	});
});
