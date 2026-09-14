import { describe, expect, it } from "vitest";
import { draftToExport, rawToDraft, type RubricDataRaw } from "@/utils/rubric";

/** 线上 rubric.json 的形态（backend/modules/training/scoring/rubric.json）。 */
function productionRubric(): RubricDataRaw {
	return {
		id: "nursing_history_v1",
		name: "护理病史采集训练评分标准",
		version: "1.0",
		total_max: 100,
		scale: 100,
		raw_max: 38,
		raw_scale: 2,
		dimensions: [
			{
				id: "communication",
				name: "沟通技能",
				max: 28,
				description: "沟通技巧",
				items: [
					{
						id: "comm_01",
						name: "学生与病人打招呼并问候",
						anchors: { "2": "主动礼貌问候", "1": "有简单问候", "0": "未问候" },
					},
				],
			},
		],
	};
}

describe("rubric 编辑→导出", () => {
	it("不做编辑直接导出：除锚点顺序外与部署文件逐字段相等（刻度不被重写）", () => {
		const source = productionRubric();
		const exported = draftToExport(rawToDraft(source));
		expect(exported).toEqual(source);
		expect(exported.scale).toBe(100);
		expect(exported.raw_max).toBe(38);
		expect(exported.raw_scale).toBe(2);
	});

	it("改动维度满分后导出仍保留原始评分刻度", () => {
		const draft = rawToDraft(productionRubric());
		draft.dimensions[0].max = 40;
		const exported = draftToExport(draft);
		expect(exported.dimensions[0].max).toBe(40);
		expect(exported.raw_max).toBe(38);
		expect(exported.raw_scale).toBe(2);
		expect(exported.scale).toBe(100);
	});

	it("锚点按分数升序展示、导出回落为字符串键映射", () => {
		const draft = rawToDraft(productionRubric());
		expect(draft.dimensions[0].items[0].anchors.map((a) => a.score)).toEqual([0, 1, 2]);
		expect(draftToExport(draft).dimensions[0].items[0].anchors).toEqual({
			"0": "未问候",
			"1": "有简单问候",
			"2": "主动礼貌问候",
		});
	});
});
