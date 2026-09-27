import { describe, expect, it } from "vitest";
import { computeCovered, extractKeywords, getInquiryLabel, parseGuidedHints, progressColor } from "@/components/training/tools/inquiryProgress";

describe("extractKeywords（v0 bigram）", () => {
	it("生成去重 2 字 token", () => {
		const kws = extractKeywords("胸闷持续时间");
		expect(kws).toContain("胸闷");
		expect(kws).toContain("持续");
		expect(kws).toContain("时间");
	});

	it("括号字符被空格替换，令牌跨边界生成", () => {
		const kws = extractKeywords("既往史（高血压、糖尿病）");
		expect(kws).toContain("既往");
		expect(kws).toContain("高血");
	});
});

describe("getInquiryLabel", () => {
	it("去除括号说明并截断", () => {
		expect(getInquiryLabel("疼痛性质（刺痛/钝痛/放射痛）")).toBe("疼痛性质");
	});
});

describe("computeCovered", () => {
	it("任一大词条命中学生发言即覆盖", () => {
		const covered = computeCovered(["胸闷持续时间", "既往心脏病史"], "请问您胸闷多久了");
		expect(covered.has(0)).toBe(true);
		expect(covered.has(1)).toBe(false);
	});

	it("无学生发言时零覆盖", () => {
		expect(computeCovered(["胸闷持续时间"], "").size).toBe(0);
	});
});

describe("progressColor（任务清单分档）", () => {
	it(">=80 绿，40-79 琥珀，<40 红", () => {
		expect(progressColor(80)).toBe("success");
		expect(progressColor(79)).toBe("warning");
		expect(progressColor(40)).toBe("warning");
		expect(progressColor(39)).toBe("danger");
	});
});

describe("parseGuidedHints（引导提示只认「领域 + 意义」）", () => {
	it("保留领域与意义，忽略缺领域的条目", () => {
		const hints = parseGuidedHints([
			{ clue_id: "c1", domain: "诱因", significance: "决定是否需立即上报", source: "patient" },
			{ clue_id: "c2", significance: "没有领域名" },
			"not-an-object",
			null,
		]);
		expect(hints).toEqual([
			{ clueId: "c1", domain: "诱因", significance: "决定是否需立即上报", source: "patient" },
		]);
	});

	it("非数组/缺字段一律当作「没有提示」，由调用方回落而不是假装有", () => {
		expect(parseGuidedHints(undefined)).toEqual([]);
		expect(parseGuidedHints(null)).toEqual([]);
		expect(parseGuidedHints("诱因")).toEqual([]);
		expect(parseGuidedHints([{ domain: "   " }])).toEqual([]);
	});
});
