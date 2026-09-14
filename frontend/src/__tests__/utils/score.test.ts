import { describe, expect, it } from "vitest";
import { getScoreDenominator, toScoreData } from "@/utils/score";

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
