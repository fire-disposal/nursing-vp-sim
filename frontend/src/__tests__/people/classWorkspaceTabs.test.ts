import { describe, expect, it } from "vitest";
import {
	buildTabSearch,
	CLASS_TAB_PARAMS,
	parseClassTab,
	parseMemberRole,
	parseOffset,
	parseRecordStatus,
} from "@/pages/people/class-workspace-tabs";

describe("班级工作台 URL 模型", () => {
	it("非法/缺失页签回落到概览", () => {
		expect(parseClassTab(null)).toBe("overview");
		expect(parseClassTab("bogus")).toBe("overview");
		expect(parseClassTab("records")).toBe("records");
	});

	it("成员角色只认 teacher，其余按学生", () => {
		expect(parseMemberRole("teacher")).toBe("teacher");
		expect(parseMemberRole("student")).toBe("student");
		expect(parseMemberRole("admin")).toBe("student");
	});

	it("记录状态只接受已知取值", () => {
		expect(parseRecordStatus("completed")).toBe("completed");
		expect(parseRecordStatus("weird")).toBe("");
		expect(parseRecordStatus(null)).toBe("");
	});

	it("分页参数非法值回到第一页", () => {
		expect(parseOffset("40")).toBe(40);
		expect(parseOffset("-10")).toBe(0);
		expect(parseOffset("abc")).toBe(0);
		expect(parseOffset(null)).toBe(0);
	});

	it("切页签只改 tab，其余页签的分页与筛选原样保留", () => {
		const current = new URLSearchParams("tab=members&member_offset=20&record_offset=40");
		const next = buildTabSearch(current, "records");
		expect(next.get("tab")).toBe("records");
		// 每个页签各自的分页留在 URL 里，返回时才能回到原处
		expect(next.get("member_offset")).toBe("20");
		expect(next.get("record_offset")).toBe("40");
	});

	it("回到默认页签时删掉 tab，保持链接干净", () => {
		const next = buildTabSearch(new URLSearchParams("tab=assignments"), "overview");
		expect(next.get("tab")).toBeNull();
	});

	it("参数字典不重叠：每个页签的分页键互不相同", () => {
		const keys = Object.values(CLASS_TAB_PARAMS).flatMap((v) => Object.values(v));
		expect(new Set(keys).size).toBe(keys.length);
	});
});
