import { describe, expect, it } from "vitest";
import {
	CLINICAL_REASONING_FIELD_HINTS,
	CLINICAL_REASONING_WORKFLOW_ID,
	createClinicalReasoningTemplate,
	withClinicalReasoningTemplate,
} from "@/components/admin/cases/clinicalReasoningTemplate";

/** 模板的可见形状（只取断言需要的那几层）。 */
type TemplateShape = {
	workflow?: string;
	activities?: unknown;
	findings: { id: string; critical?: boolean }[];
	initial: { visible_findings: string[]; hidden_findings: string[] };
	objectives: Record<string, { id: string }[]>;
	rubric: { anchors: { objectives?: string[] }[] };
};

const template = () => createClinicalReasoningTemplate() as unknown as TemplateShape;

describe("临床判断病例模板", () => {
	it("声明 workflow 并覆盖六个声明面", () => {
		const data = template();
		expect(data.workflow).toBe(CLINICAL_REASONING_WORKFLOW_ID);
		for (const hint of CLINICAL_REASONING_FIELD_HINTS) {
			expect((createClinicalReasoningTemplate() as Record<string, unknown>)[hint.path]).toBeDefined();
		}
	});

	it("骨架自洽：每条证据都能拿到、每个目标都被锚点覆盖", () => {
		const data = template();
		const obtainable = new Set([...data.initial.visible_findings, ...data.initial.hidden_findings]);
		for (const finding of data.findings) {
			expect(obtainable.has(finding.id)).toBe(true);
		}
		const covered = new Set(data.rubric.anchors.flatMap((anchor) => anchor.objectives ?? []));
		for (const objective of Object.values(data.objectives).flat()) {
			expect(covered.has(objective.id)).toBe(true);
		}
	});

	it("不声明 activities：该 workflow 的 Activity 白名单为空，声明即被发布门禁拒绝", () => {
		expect(template().activities).toBeUndefined();
	});

	it("插入模板保留病例元数据、丢弃问诊内容", () => {
		const merged = withClinicalReasoningTemplate({
			name: "我的病例",
			description: "描述",
			difficulty: 3,
			time_limit: 45,
			chief_complaint: "咳嗽三天",
			activities: { physical_exam: { config: { vital_signs: {} } } },
		});

		expect(merged.name).toBe("我的病例");
		expect(merged.description).toBe("描述");
		expect(merged.difficulty).toBe(3);
		expect(merged.time_limit).toBe(45);
		expect(merged.workflow).toBe(CLINICAL_REASONING_WORKFLOW_ID);
		expect(merged.chief_complaint).toBeUndefined();
		expect(merged.activities).toBeUndefined();
	});
});
