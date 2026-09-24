import { describe, expect, it } from "vitest";
import { computeCovered, extractKeywords, getInquiryLabel, progressColor } from "@/components/training/tools/inquiryProgress";

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
