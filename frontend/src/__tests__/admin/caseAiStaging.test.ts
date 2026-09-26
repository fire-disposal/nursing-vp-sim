import { describe, expect, it } from "vitest";
import type { CaseJsonValue } from "@/components/admin/cases/CaseEditorState";
import {
	applyAcceptedChanges,
	diffCaseData,
	summarizeValue,
} from "@/components/admin/cases/ai/staging";

type Json = Record<string, CaseJsonValue>;

const base = (): Json => ({
	name: "旧病例名",
	chief_complaint: "咳嗽3天",
	present_illness: "现病史原文",
	hidden_info: ["旧隐藏"],
	activities: { quiz: { config: { questions: [] } } },
});

describe("病例 AI 生成的差异与应用", () => {
	it("只报告生成结果里出现且确有差异的字段", () => {
		const after: Json = {
			name: "旧病例名", // 未变
			chief_complaint: "咳嗽伴咳痰 1 周", // 变化
			// present_illness 未出现在生成结果里 → 不算变化
			activities: { physical_exam: { config: { vital_signs: { T: "38.5" } } } }, // 新增嵌套路径
		};
		const changes = diffCaseData(base(), after);
		expect(changes.map((c) => c.path)).toEqual([
			"chief_complaint",
			"activities.physical_exam.config",
		]);
		expect(changes[0].before).toBe("咳嗽3天");
		expect(changes[0].after).toBe("咳嗽伴咳痰 1 周");
	});

	it("未接受的字段保持教师当前内容", () => {
		const before = base();
		const after: Json = { chief_complaint: "新主诉", hidden_info: ["新隐藏1", "新隐藏2"] };
		const changes = diffCaseData(before, after);
		const applied = applyAcceptedChanges(before, changes, ["chief_complaint"]);
		expect(applied.chief_complaint).toBe("新主诉");
		expect(applied.hidden_info).toEqual(["旧隐藏"]); // 未接受 → 原样保留
	});

	it("写入嵌套路径时不破坏同级 Activity 声明", () => {
		const before = base();
		const after: Json = { activities: { physical_exam: { config: { vital_signs: {} } } } };
		const changes = diffCaseData(before, after);
		const applied = applyAcceptedChanges(before, changes, ["activities.physical_exam.config"]);
		const activities = applied.activities as Record<string, unknown>;
		expect(activities.quiz).toEqual({ config: { questions: [] } }); // 教师既有 quiz 声明未被抹掉
		expect(activities.physical_exam).toEqual({ config: { vital_signs: {} } });
	});

	it("值摘要：长文本截断、数组给条数、空值有明确文案", () => {
		expect(summarizeValue("短")).toBe("短");
		expect(summarizeValue("x".repeat(200))).toContain("…");
		expect(summarizeValue(["a", "b"])).toBe("2 条：a；b");
		expect(summarizeValue([])).toBe("（空列表）");
		expect(summarizeValue("")).toBe("（空）");
		expect(summarizeValue(undefined)).toBe("（空）");
	});
});
