import { describe, expect, it } from "vitest";
import {
	fallbackKindLabel,
	getEffectiveTotal,
	getScoreDenominator,
	itemStatusLabel,
	messageRefIds,
	resolveScoreSource,
	toScoreData,
} from "@/utils/score";

describe("getScoreDenominator（全站唯一评分分母）", () => {
	it("取各维度满分之和", () => {
		expect(
			getScoreDenominator({
				total_score: 100,
				detail_scores: {
					问诊: { score: 18, max: 30 },
					沟通: { score: 25, max: 40 },
					评估: { score: 20, max: 30 },
				},
			}),
		).toBe(100);
	});

	it("维度缺 max 时不编造分母（不再 +30 兜底）", () => {
		expect(
			getScoreDenominator({
				detail_scores: {
					有上限: { score: 3, max: 20 },
					无上限: { score: 4, max: 0 },
				},
			}),
		).toBe(20);
	});

	it("无维度信息回退到总分，仍无则用 100 分制默认值", () => {
		expect(getScoreDenominator({ total_score: 78 })).toBe(78);
		expect(getScoreDenominator({})).toBe(100);
		expect(getScoreDenominator(null)).toBe(100);
	});
});

describe("toScoreData（评分载荷唯一转换点）", () => {
	it("对象原样返回，非对象返回 null", () => {
		const raw = { total_score: 80, detail_scores: {} };
		expect(toScoreData(raw)).toBe(raw);
		expect(toScoreData(null)).toBeNull();
		expect(toScoreData(undefined)).toBeNull();
		expect(toScoreData("80")).toBeNull();
	});
});

describe("有效成绩与来源（服务端口径，前端不另立规则）", () => {
	it("effective_total 优先，缺失时才按 reviewed_total → total_score 回退", () => {
		expect(getEffectiveTotal({ effective_total: 84, reviewed_total: 84, total_score: 72 })).toBe(84);
		expect(getEffectiveTotal({ reviewed_total: 84, total_score: 72 })).toBe(84);
		expect(getEffectiveTotal({ total_score: 72 })).toBe(72);
		expect(getEffectiveTotal({})).toBeNull();
		expect(getEffectiveTotal(null)).toBeNull();
	});

	it("source 用服务端值；历史行按「降级 > 复核 > AI」同一优先级推导", () => {
		expect(resolveScoreSource({ source: "review", total_score: 72 })).toBe("review");
		expect(resolveScoreSource({ reviewed_total: 84, total_score: 72 })).toBe("review");
		expect(resolveScoreSource({ fallback: { kind: "llm_empty" }, reviewed_total: 84 })).toBe("fallback");
		expect(resolveScoreSource({ total_score: 72 })).toBe("ai");
		expect(resolveScoreSource(null)).toBe("ai");
	});
});

describe("条目状态与降级原因文案", () => {
	it("不适用 / 未判定 都有明确文案，已判定条目不编状态", () => {
		expect(itemStatusLabel({ status: "not_applicable", score: null })).toBe("本次不适用");
		expect(itemStatusLabel({ status: "unscored_by_model", score: null })).toBe("系统未判定");
		// 没给 status 但分数为空：同样是"没有判定"，不能显示成 0 分
		expect(itemStatusLabel({ score: null })).toBe("系统未判定");
		expect(itemStatusLabel({ status: "scored", score: 2 })).toBeNull();
	});

	it("降级 kind 映射为中文说明，未知 kind 也不吞掉", () => {
		expect(fallbackKindLabel({ kind: "llm_empty" })).toContain("空结果");
		expect(fallbackKindLabel({ kind: "items_unscored" })).toContain("条目");
		expect(fallbackKindLabel({ kind: "brand_new_kind" })).toContain("brand_new_kind");
		expect(fallbackKindLabel(null)).toContain("原因未知");
	});
});

describe("messageRefIds（证据跳转只认服务端定位到的消息）", () => {
	it("只取 message 类引用", () => {
		expect(
			messageRefIds([
				{ kind: "message", id: 101, role: "student" },
				{ kind: "action", id: 5, action: "exam" },
				{ kind: "message", id: 102 },
			]),
		).toEqual([101, 102]);
		expect(messageRefIds(undefined)).toEqual([]);
	});
});
