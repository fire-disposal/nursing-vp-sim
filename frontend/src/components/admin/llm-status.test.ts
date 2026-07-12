import { describe, expect, it } from "vitest";
import {
	costColorClass,
	degradedReasonLabel,
	recoveryText,
	statusText,
} from "./llm-status";

describe("degradedReasonLabel", () => {
	it("maps known reasons", () => {
		expect(degradedReasonLabel("rate_limited")).toBe("限流");
		expect(degradedReasonLabel("consecutive_failures")).toBe("连续失败");
		expect(degradedReasonLabel("cost_exceeded")).toBe("超预算");
	});
	it("falls back for unknown/empty", () => {
		expect(degradedReasonLabel(null)).toBe("降级");
		expect(degradedReasonLabel("weird")).toBe("降级");
	});
});

describe("statusText", () => {
	it("maps status", () => {
		expect(statusText("active")).toBe("正常");
		expect(statusText("degraded")).toBe("熔断");
		expect(statusText("disabled")).toBe("停用");
		expect(statusText("other")).toBe("停用");
	});
});

describe("recoveryText", () => {
	const now = new Date("2026-07-12T00:00:00Z");
	it("returns empty when no degradedUntil", () => {
		expect(recoveryText(null, "rate_limited", now)).toBe("");
	});
	it("returns empty when already past", () => {
		expect(recoveryText("2026-07-11T23:59:00Z", "rate_limited", now)).toBe("");
	});
	it("seconds", () => {
		expect(recoveryText("2026-07-12T00:00:45Z", "rate_limited", now)).toBe(
			"约 45s 后恢复",
		);
	});
	it("minutes", () => {
		expect(recoveryText("2026-07-12T00:05:00Z", "consecutive_failures", now)).toBe(
			"约 5 分钟后恢复",
		);
	});
	it("cost_exceeded shows 下月恢复", () => {
		expect(recoveryText("2026-08-01T00:00:00Z", "cost_exceeded", now)).toBe(
			"下月恢复",
		);
	});
});

describe("costColorClass", () => {
	it("normal below 90%", () => {
		expect(costColorClass(10, 100)).toBe("");
	});
	it("amber at 90%+", () => {
		expect(costColorClass(90, 100)).toBe("text-warning-foreground");
	});
	it("red at/over limit", () => {
		expect(costColorClass(100, 100)).toBe("text-danger-foreground");
	});
	it("no limit -> normal", () => {
		expect(costColorClass(50, null)).toBe("");
		expect(costColorClass(50, 0)).toBe("");
	});
});
