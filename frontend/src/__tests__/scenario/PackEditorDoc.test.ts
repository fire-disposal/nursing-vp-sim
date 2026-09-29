/**
 * 场景编辑器文档层：内容的读取、不可变写入、改动摘要、校验问题归位。
 *
 * 共同点：都**不碰后端**——它们决定"改一处会不会带动别的字段""哪些字段算改了""问题落在哪一节"，
 * 所以必须能单独钉住。组件行为在 `ScenarioEditor.test.tsx` 里覆盖。
 */

import { describe, expect, it } from "vitest";
import type { ScenarioPackDoc } from "@/api/scenario";
import { sectionForPath } from "@/scenario/admin/editor/sections";
import {
	boolAt,
	deleteIn,
	diffPaths,
	listAt,
	moveIn,
	nodeAt,
	numberAt,
	removeAt,
	setIn,
	tableAt,
	textAt,
} from "@/scenario/admin/editor/packDoc";

const DOC: ScenarioPackDoc = {
	key: "demo-pack",
	title: "示例",
	brief: "夜班，病房很安静。",
	state_keys: { "scene.spo2": 88, "patient.comfort": 2 },
	state_bounds: { "scene.spo2": { lo: 0, hi: 100 } },
	setting: { place: "病房", cues: [{ id: "c1", text: "安静", visible_from_start: true }] },
	actors: [{ id: "patient", role: "患者", presence: "on_site", persona: "他只想喘上气。" }],
	presentation: { devices: [{ id: "monitor", channels: [{ ref: "scene.spo2" }] }] },
};

describe("改动摘要", () => {
	it("列出叶子级改动路径（含列表下标与新增项）", () => {
		const next = setIn(DOC, ["setting", "place"], "另一间病房");
		expect(diffPaths(DOC, next)).toEqual(["setting.place"]);

		const added = setIn(DOC, ["setting", "cues", 1], { id: "c2", text: "脚步声" });
		expect(diffPaths(DOC, added)).toEqual(["setting.cues[1]"]);
	});

	it("同一份内容没有改动", () => {
		expect(diffPaths(DOC, structuredClone(DOC))).toEqual([]);
	});
});

describe("取值与不可变写", () => {
	it("setIn 返回新对象，原对象不动", () => {
		const next = setIn(DOC, ["actors", 0, "role"], "家属");
		expect(textAt(next, "actors", 0, "role")).toBe("家属");
		expect(textAt(DOC, "actors", 0, "role")).toBe("患者");
	});

	it("deleteIn 删掉表里的一个键（列表项不走它），同级其它键与其它层都不动", () => {
		const next = deleteIn(DOC, ["state_keys", "scene.spo2"]);
		expect(Object.keys(tableAt(next, "state_keys"))).toEqual(["patient.comfort"]);
		expect(next.state_bounds).toEqual(DOC.state_bounds);
		expect(next.setting).toEqual(DOC.setting);
		expect(Object.keys(tableAt(DOC, "state_keys"))).toHaveLength(2);
	});

	it("取值助手对缺失/类型不符给安全默认（不抛）", () => {
		expect(textAt(DOC, "nope", "deeper")).toBe("");
		expect(numberAt(DOC, ["presentation", "devices", 0, "size"], 3)).toBe(3);
		expect(boolAt(DOC, "setting", "cues", 0, "visible_from_start")).toBe(true);
		expect(boolAt(DOC, "setting", "cues", 5, "visible_from_start")).toBe(false);
		expect(listAt<string>(DOC, "setting", "cues", 0, "text")).toEqual([]);
		expect(listAt<string>(DOC, "truth")).toEqual([]);
		expect(tableAt(DOC, "state_bounds")).toEqual({ "scene.spo2": { lo: 0, hi: 100 } });
		expect(nodeAt(DOC, "state_keys", "scene.spo2")).toBe(88);
		expect(nodeAt(DOC, "state_keys", "nope")).toBeUndefined();
	});
});

describe("列表操作（增删排序共用）", () => {
	it("上移/下移交换位置，越界不动", () => {
		expect(moveIn([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
		expect(moveIn([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
		expect(moveIn([1, 2, 3], 1, 9)).toEqual([1, 2, 3]);
	});

	it("删除", () => {
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
		expect(sectionForPath("state_keys.scene.spo2")).toBe("state");
		expect(sectionForPath("state_bounds[scene.spo2]")).toBe("state");
		expect(sectionForPath("presentation.devices[monitor].channels[scene.spo2]")).toBe("devices");
		expect(sectionForPath("failure_when")).toBe("failure");
		expect(sectionForPath("assets[a_room]")).toBe("assets");
	});

	it("散文与人物段落各自归位（persona 归散文，人物本身归表单）", () => {
		expect(sectionForPath("brief")).toBe("brief");
		expect(sectionForPath("truth[0]")).toBe("truth");
		expect(sectionForPath("teacher_notes")).toBe("teacher_notes");
		expect(sectionForPath("actors.0.persona")).toBe("personas");
	});

	it("认不出属于哪一节：给 null（只在顶部摘要里列出来）", () => {
		expect(sectionForPath("something_unheard_of")).toBeNull();
	});
});
