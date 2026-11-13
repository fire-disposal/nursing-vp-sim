import { describe, expect, it } from "vitest";
import { getDefaultCaseJson } from "@/components/admin/cases/CaseEditorState";
import { withGenerationTemplate } from "@/components/admin/cases/case-generations";

describe("病例代际模板", () => {
	it("V1/V2 往返只保留公共元数据，不残留另一代际字段", () => {
		const v1 = {
			...getDefaultCaseJson(),
			name: "低氧病例",
			description: "识别与处置",
			activities: { physical_exam: { config: { vital_signs: {} } } },
		};

		const v2 = withGenerationTemplate(v1, "clinical_reasoning");
		expect(v2.workflow).toBe("clinical_reasoning");
		expect(v2.name).toBe("低氧病例");
		expect(v2.description).toBe("识别与处置");
		expect(v2.findings).toBeDefined();
		expect(v2.activities).toBeUndefined();
		expect(v2.required_inquiries).toBeUndefined();

		const back = withGenerationTemplate(v2, "history_taking");
		expect(back.workflow).toBe("history_taking");
		expect(back.name).toBe("低氧病例");
		expect(back.findings).toBeUndefined();
		expect(back.scenario).toBeUndefined();
		expect(back.rubric).toBeUndefined();
	});
});
