/**
 * 编辑器的**分节表**：一份 pack 内容有哪几节、每节归哪张页签、每节覆盖哪些字段路径。
 *
 * 只有这一份映射：顶部摘要据此把后端的校验问题指到"哪张页签的哪一节"，
 * 每张页签里的 `Section` 也按同一张表取自己的问题——两处说法不会各说各话。
 */

import type { ScenarioPackProblem } from "@/api/scenario";

/** 一个分节归哪张页签。 */
export type PackSectionTab = "form" | "prose" | "assets";

/** 每一节覆盖哪些字段前缀。 */
export const PACK_SECTIONS: {
	id: string;
	label: string;
	tab: PackSectionTab;
	prefixes: string[];
}[] = [
	{ id: "basic", label: "基本信息", tab: "form", prefixes: ["title", "one_line", "player", "key"] },
	{ id: "setting", label: "场景", tab: "form", prefixes: ["setting.place", "setting.time_hint", "setting.resources"] },
	{ id: "cues", label: "线索", tab: "form", prefixes: ["setting.cues"] },
	{ id: "actors", label: "在场者", tab: "form", prefixes: ["actors"] },
	{ id: "state", label: "状态键与边界", tab: "form", prefixes: ["state_keys", "state_bounds"] },
	{ id: "affordances", label: "动作", tab: "form", prefixes: ["affordances"] },
	{ id: "facts", label: "事实", tab: "form", prefixes: ["facts"] },
	{ id: "rubric", label: "判据", tab: "form", prefixes: ["rubric"] },
	{ id: "devices", label: "设备", tab: "form", prefixes: ["presentation"] },
	{ id: "failure", label: "结局", tab: "form", prefixes: ["failure", "failure_when"] },
	{ id: "brief", label: "处境", tab: "prose", prefixes: ["brief"] },
	{ id: "personas", label: "人物", tab: "prose", prefixes: [] },
	{ id: "truth", label: "真相", tab: "prose", prefixes: ["truth"] },
	{ id: "teacher_notes", label: "教师备注", tab: "prose", prefixes: ["teacher_notes"] },
	{ id: "assets", label: "图片", tab: "assets", prefixes: ["assets"] },
];

/** 一条校验问题属于哪一节（认不出 → `null`，只在顶部摘要里列出）。 */
export function sectionForPath(path: string): string | null {
	// 人物的散文段落与人物本身同前缀：按**字段**分，前者的路径以 `.persona` 结尾
	if (/(^|\.)persona(s)?$/.test(path) || /(^|\.)personas($|\.)/.test(path)) return "personas";
	const hit = PACK_SECTIONS.find((section) =>
		section.prefixes.some(
			(prefix) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`),
		),
	);
	return hit?.id ?? null;
}

/** 某一节自己的校验问题（问题来自后端，不在这里重算）。 */
export function issuesOf(problems: ScenarioPackProblem[], id: string) {
	return problems.filter((problem) => sectionForPath(problem.path) === id);
}
