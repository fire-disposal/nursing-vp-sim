import { describe, expect, it } from "vitest";
import { computeCompletionGroups } from "./completions";

describe("computeCompletionGroups", () => {
	it("returns nothing without a leading slash", () => {
		expect(computeCompletionGroups("assess")).toEqual([]);
		expect(computeCompletionGroups("")).toEqual([]);
	});

	it("groups all commands by backend help group for a bare slash", () => {
		const groups = computeCompletionGroups("/");
		expect(groups.map((g) => g.name)).toEqual(["信息", "评估", "检查", "给药", "对话", "处理"]);
		const info = groups[0];
		expect(info.items.map((c) => c.label)).toContain("/status");
		expect(info.items.map((c) => c.label)).toContain("/help");
		expect(groups.some((g) => g.items.some((c) => c.label === "/consult"))).toBe(true);
	});

	it("prefix-matches commands inside their group", () => {
		const groups = computeCompletionGroups("/as");
		expect(groups.map((g) => g.name)).toEqual(["评估"]);
		expect(groups[0].items.map((c) => c.label)).toEqual(["/assess"]);
		expect(groups[0].items[0].desc).toContain("评估");
	});

	it("drills into sub-targets when a command is fully typed", () => {
		const groups = computeCompletionGroups("/assess");
		expect(groups).toHaveLength(1);
		const labels = groups[0].items.map((c) => c.label);
		for (const target of ["vitals", "drain", "pain", "urine", "glucose", "breath"]) {
			expect(labels).toContain(`/assess ${target}`);
		}
		expect(groups[0].items.find((c) => c.label === "/assess vitals")?.desc).toContain("生命体征");
	});

	it("prefix-matches sub-targets", () => {
		expect(computeCompletionGroups("/assess v")[0].items.map((c) => c.label)).toEqual(["/assess vitals"]);
		expect(computeCompletionGroups("/order c")[0].items.map((c) => c.label)).toEqual(["/order cbc", "/order coag"]);
		expect(computeCompletionGroups("/give F")[0].items.map((c) => c.label)).toEqual(["/give FLUIDS"]);
	});

	it("hides a fully-typed parameter (nothing left to complete)", () => {
		expect(computeCompletionGroups("/assess vitals")).toEqual([]);
	});

	it("matches multi-word commands and hides the exact full command", () => {
		const wait = computeCompletionGroups("/wait");
		const labels = wait.flatMap((g) => g.items.map((c) => c.label));
		expect(labels).toContain("/wait cbc");
		expect(labels).not.toContain("/wait");
	});

	it("hides the panel when a plain command is exactly typed", () => {
		expect(computeCompletionGroups("/status")).toEqual([]);
		expect(computeCompletionGroups("/diag")).toEqual([]);
	});

	it("provides Chinese explanations", () => {
		const status = computeCompletionGroups("/sta")[0].items[0];
		expect(status.desc).toContain("状态");
	});
});
