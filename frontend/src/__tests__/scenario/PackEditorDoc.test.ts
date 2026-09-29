/**
 * 场景编辑器纯函数层：原始文本（JSON）互转、改动摘要、列表操作。
 *
 * 共同点：都**不碰后端**——它们决定"改表单会不会改文本""哪些字段算改了""保存会不会多一条修订"，
 * 所以必须能单独钉住。组件行为在 `ScenarioEditor.test.tsx` 里覆盖。
 */

import { describe, expect, it } from "vitest";
import type { ScenarioPackDoc } from "@/api/scenario";
import { sectionForPath } from "@/scenario/admin/editor/PackForm";
import {
	boolAt,
	describeJsonError,
	diffPaths,
	fromJsonText,
	insertAt,
	listAt,
	moveIn,
	numberAt,
	removeAt,
	setIn,
	textAt,
	toJsonText,
} from "@/scenario/admin/editor/packDoc";

const DOC: ScenarioPackDoc = {
	key: "demo-pack",
	title: "示例",
	state_keys: { "scene.spo2": 88, "patient.comfort": 2 },
	setting: { place: "病房", cues: [{ id: "c1", text: "安静", visible_from_start: true }] },
	actors: [{ id: "patient", role: "患者", presence: "on_site", goals: ["喘上气"] }],
	presentation: { panels: ["timeline"], devices: [] },
};

describe("原始文本互转（JSON）", () => {
	it("内容 → 文本 → 内容逐字段不变（含带点号的状态键与 null）", () => {
		const doc: ScenarioPackDoc = { ...DOC, note: null };
		expect(fromJsonText(toJsonText(doc))).toEqual(doc);
	});

	it("文本是两空格缩进的 JSON（人能读、diff 稳定）", () => {
		expect(toJsonText({ a: 1, b: ["x"] })).toBe('{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}');
	});

	it("顶层必须是对象：数组/标量直接报错，不静默变成空内容", () => {
		expect(() => fromJsonText("[1, 2]")).toThrow("顶层必须是一个对象");
		expect(() => fromJsonText('"文字"')).toThrow("顶层必须是一个对象");
		expect(() => fromJsonText("null")).toThrow("顶层必须是一个对象");
	});

	it("解析失败给可读错误（尽量带行列，不是一句英文）", () => {
		let message = "";
		try {
			fromJsonText('{\n  "a": 1\n  "b": 2\n}');
		} catch (error) {
			message = describeJsonError(error);
		}
		expect(message).toMatch(/第 \d+ 行|第 \d+ 个字符处/);
	});
});

describe("改动摘要", () => {
	it("列出叶子级改动路径（含列表下标与新增项）", () => {
		const next = setIn(DOC, ["setting", "place"], "另一间病房");
		expect(diffPaths(DOC, next)).toEqual(["setting.place"]);

		const added = setIn(DOC, ["setting", "cues", 1], { id: "c2", text: "脚步声" });
		expect(diffPaths(DOC, added)).toEqual(["setting.cues[1]"]);
	});

	it("同一份内容没有改动", () => {
		expect(diffPaths(DOC, fromJsonText(toJsonText(DOC)))).toEqual([]);
	});
});

describe("取值与不可变写", () => {
	it("setIn 返回新对象，原对象不动", () => {
		const next = setIn(DOC, ["actors", 0, "role"], "家属");
		expect(textAt(next, "actors", 0, "role")).toBe("家属");
		expect(textAt(DOC, "actors", 0, "role")).toBe("患者");
	});

	it("取值助手对缺失/类型不符给安全默认（不抛）", () => {
		expect(textAt(DOC, "nope", "deeper")).toBe("");
		expect(numberAt(DOC, ["presentation", "devices", 0, "size"], 3)).toBe(3);
		expect(boolAt(DOC, "setting", "cues", 0, "visible_from_start")).toBe(true);
		expect(boolAt(DOC, "setting", "cues", 5, "visible_from_start")).toBe(false);
		expect(listAt<string>(DOC, "presentation", "panels")).toEqual(["timeline"]);
		expect(listAt<string>(DOC, "presentation", "nope")).toEqual([]);
	});
});

describe("列表操作（增删排序共用）", () => {
	it("上移/下移交换位置，越界不动", () => {
		expect(moveIn([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
		expect(moveIn([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
		expect(moveIn([1, 2, 3], 1, 9)).toEqual([1, 2, 3]);
	});

	it("插入与删除", () => {
		expect(insertAt([1, 3], 1, 2)).toEqual([1, 2, 3]);
		expect(removeAt([1, 2, 3], 1)).toEqual([1, 3]);
	});
});

describe("校验问题归位到节", () => {
	it("集合[id]、pydantic 下标与顶层字段都能落到某一节", () => {
		expect(sectionForPath("affordances[suction].type")).toBe("affordances");
		expect(sectionForPath("actors.0.presence")).toBe("actors");
		expect(sectionForPath("setting.cues[c1]")).toBe("cues");
		expect(sectionForPath("rubric[c1]: 缺锚点")).toBe("rubric");
		expect(sectionForPath("title")).toBe("basic");
		expect(sectionForPath("state_keys.scene.spo2")).toBeNull();
	});
});
