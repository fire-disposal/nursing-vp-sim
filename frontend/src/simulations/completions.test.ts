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
		expect(info.items.map((c) => c.label)).toContain("/状态");
		expect(info.items.map((c) => c.label)).toContain("/帮助");
		expect(groups.some((g) => g.items.some((c) => c.label === "/会诊"))).toBe(true);
	});

	it("prefix-matches commands inside their group", () => {
		const groups = computeCompletionGroups("/as");
		expect(groups.map((g) => g.name)).toEqual(["评估"]);
		expect(groups[0].items.map((c) => c.label)).toEqual(["/评估"]);
		expect(groups[0].items[0].desc).toContain("评估");
	});

	it("prefix-matches Chinese command heads", () => {
		expect(computeCompletionGroups("/评").map((g) => g.name)).toEqual(["评估"]);
		expect(computeCompletionGroups("/等待")[0].items.length).toBeGreaterThan(0);
	});

	it("drills into sub-targets when a command is fully typed", () => {
		const groups = computeCompletionGroups("/assess");
		expect(groups).toHaveLength(1);
		const labels = groups[0].items.map((c) => c.label);
		for (const target of ["生命体征", "引流", "疼痛", "尿量", "血糖", "肺部听诊"]) {
			expect(labels).toContain(`/评估 ${target}`);
		}
		expect(groups[0].items.find((c) => c.label === "/评估 生命体征")?.desc).toContain("生命体征");
	});

	it("prefix-matches sub-targets", () => {
		expect(computeCompletionGroups("/assess v")[0].items.map((c) => c.label)).toEqual(["/评估 生命体征"]);
		expect(computeCompletionGroups("/order c")[0].items.map((c) => c.label)).toEqual(["/检查 血常规", "/检查 凝血"]);
		expect(computeCompletionGroups("/give F")[0].items.map((c) => c.label)).toEqual(["/给药 补液"]);
	});

	it("prefix-matches Chinese sub-targets", () => {
		expect(computeCompletionGroups("/评估 生")[0].items.map((c) => c.label)).toEqual(["/评估 生命体征"]);
		expect(computeCompletionGroups("/给药 吗")[0].items.map((c) => c.label)).toEqual(["/给药 吗啡"]);
	});

	it("hides a fully-typed parameter (nothing left to complete)", () => {
		expect(computeCompletionGroups("/assess vitals")).toEqual([]);
		expect(computeCompletionGroups("/评估 生命体征")).toEqual([]);
	});

	it("matches multi-word commands and hides the exact full command", () => {
		const wait = computeCompletionGroups("/wait");
		const labels = wait.flatMap((g) => g.items.map((c) => c.label));
		expect(labels).toContain("/等待 血常规");
		expect(labels).not.toContain("/wait");
		expect(labels).not.toContain("/等待");
	});

	it("hides the panel when a plain command is exactly typed", () => {
		expect(computeCompletionGroups("/status")).toEqual([]);
		expect(computeCompletionGroups("/状态")).toEqual([]);
		expect(computeCompletionGroups("/diag")).toEqual([]);
		expect(computeCompletionGroups("/诊断")).toEqual([]);
	});

	it("provides Chinese explanations", () => {
		const status = computeCompletionGroups("/sta")[0].items[0];
		expect(status.desc).toContain("状态");
	});
});
