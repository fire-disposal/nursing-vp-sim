import { describe, expect, it } from "vitest";
import { HIGHLIGHTS, OVERVIEW_STATS } from "./data";

describe("showcase data", () => {
	it("has exactly 6 highlights", () => {
		expect(HIGHLIGHTS).toHaveLength(6);
	});

	it("does not mention deprecated/inaccurate terms", () => {
		const blob = JSON.stringify(HIGHLIGHTS) + JSON.stringify(OVERVIEW_STATS);
		expect(blob).not.toMatch(/插件化|manifest|pgvector|向量检索/);
	});

	it("overview stats reflect real numbers", () => {
		const values = OVERVIEW_STATS.map((s) => s.value);
		expect(values).toContain(5);
		expect(values).toContain(19);
	});
});
