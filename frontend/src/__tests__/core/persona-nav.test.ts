import { describe, expect, it } from "vitest";
import {
	NAV_GROUPS,
	NAV_ITEMS,
	type NavGroupKey,
	filterNavByPersona,
} from "@/components/shell/navigation";
import { PERSONA_ORDER } from "@/utils/personas";

/**
 * 视角 → 导航入口的**契约**（与 `backend/core/personas.py` 对齐）。
 *
 * 视角不只是"权限够不够"（权限门仍由 `permission` 判定），还决定**这一档视角的侧栏长什么样**：
 * 运维不该被喂一屏"教学看板/班级管理"，学生也不该看到"人员/运维"分组。
 * 这里的期望列表就是书面的分组口径，改分组策略时必须同步改这里。
 *
 * 每个视角的条目都按同一套口径算：`filterNavByPersona` 之后取 label / group。
 * 契约里出现的每条 label 都从 `NAV_ITEMS` 现取，避免手写列表与真实路由漂移。
 */
const itemsOf = (persona: string) => filterNavByPersona(NAV_ITEMS, persona);
const labelsOf = (persona: string) => itemsOf(persona).map((item) => item.label);
const groupsOf = (persona: string) =>
	new Set(itemsOf(persona).map((item) => item.group ?? null));

const NAV_GROUP_PERSONAS = Object.fromEntries(
	NAV_GROUPS.map((group) => [group.key, group.personas] as const),
) as unknown as Record<NavGroupKey, readonly string[]>;

describe("视角导航过滤", () => {
	it("视角取值与后端预设一致：student/teacher/admin/ops/platform", () => {
		expect([...PERSONA_ORDER]).toEqual(["student", "teacher", "admin", "ops", "platform"]);
	});

	it("学生：看不到教学 / 教学资源 / 人员 / 运维分组", () => {
		const groups = groupsOf("student");
		// 学生端是平铺：不该凭空出现管理向分组
		for (const hidden of ["teaching", "content", "people", "system"] as const) {
			expect(groups, `学生不该看到 ${hidden} 分组`).not.toContain(hidden);
		}
	});

	it("教师：教学 + 教学资源，没有人员 / 运维分组", () => {
		const groups = groupsOf("teacher");
		for (const visible of ["teaching", "content"] as const) {
			expect(groups, `教师应看到 ${visible} 分组`).toContain(visible);
		}
		expect(groups).not.toContain("people");
		// 运维分组本身不给教师；「系统反馈」靠条目级覆盖单独可见（见下条用例）
		expect(
			itemsOf("teacher")
				.filter((item) => item.group === "system" && !item.personas)
				.map((item) => item.label),
		).toEqual([]);
	});

	it("管理：人员分组可见，教学 / 教学资源齐全", () => {
		const groups = groupsOf("admin");
		for (const key of ["people", "teaching", "content"] as const) {
			expect(groups, `管理视角缺少 ${key} 分组`).toContain(key);
		}
		// 运维分组：运维 + 平台（只有「系统反馈」被条目级对教师/管理放开）
		expect(NAV_GROUP_PERSONAS.system).toEqual(["ops", "platform"]);
	});

	it("运维：只剩运维分组，教学/人员/教学资源一律不可见", () => {
		const groups = groupsOf("ops");
		expect(groups).toContain("system");
		for (const hidden of ["teaching", "content", "people"] as const) {
			expect(groups, `运维视角不该看到 ${hidden} 分组`).not.toContain(hidden);
		}
		const labels = labelsOf("ops");
		for (const teaching of ["教学看板", "批改工作台", "作业管理", "成绩管理", "班级管理", "病例库", "用户管理"]) {
			expect(labels).not.toContain(teaching);
		}
		expect(labels).toContain("审计日志");
	});

	it("「系统反馈」对教师 / 管理 / 运维 / 平台可见，对学生不可见", () => {
		for (const persona of ["teacher", "admin", "ops", "platform"]) {
			expect(labelsOf(persona), `${persona} 应看到系统反馈`).toContain("系统反馈");
		}
		expect(labelsOf("student")).not.toContain("系统反馈");
	});

	it("条目级 personas 覆盖分组口径（是取代，不是并集）", () => {
		const feedback = NAV_ITEMS.find((item) => item.label === "系统反馈");
		expect(feedback?.personas).toEqual(["teacher", "admin", "ops", "platform"]);
		// 分组本身给运维 + 平台
		expect(NAV_GROUP_PERSONAS.system).toEqual(["ops", "platform"]);
		// 运维分组里除覆盖条目外，教师/管理一个都看不到
		const leaked = itemsOf("admin")
			.filter((item) => item.group === "system" && !item.personas)
			.map((item) => item.label);
		expect(leaked).toEqual([]);
	});

	it("平台：人员 / 教学资源 / 运维可见，教学分组不可见", () => {
		const groups = groupsOf("platform");
		expect(groups).toContain("people");
		expect(groups).toContain("content");
		expect(groups).toContain("system");
		expect(groups).not.toContain("teaching");
		const labels = labelsOf("platform");
		expect(labels).toContain("院校管理");
		expect(labels).toContain("审计日志");
	});

	it("每个视角都至少留下一个入口（不允许把侧栏过滤成空）", () => {
		for (const persona of PERSONA_ORDER) {
			expect(itemsOf(persona).length, `${persona} 的侧栏为空`).toBeGreaterThan(0);
		}
	});

	it("视角缺失或未知取值：原样返回，认不出视角不代表没有入口", () => {
		expect(filterNavByPersona(NAV_ITEMS, null)).toHaveLength(NAV_ITEMS.length);
		expect(filterNavByPersona(NAV_ITEMS, undefined)).toHaveLength(NAV_ITEMS.length);
		expect(filterNavByPersona(NAV_ITEMS, "")).toHaveLength(NAV_ITEMS.length);
		// legacy 自定义角色名（后端会把 role.name 当视角回传）：不做臆测，交给权限门
		expect(filterNavByPersona(NAV_ITEMS, "nurse_lead")).toHaveLength(NAV_ITEMS.length);
	});

	it("过滤只做裁剪：不新增条目、顺序与 NAV_ITEMS 一致", () => {
		for (const persona of PERSONA_ORDER) {
			const kept = itemsOf(persona);
			// 子序列：过滤不得重排（按 `to` 判序，不依赖对象身份 —— 实现可能给条目补分组）
			const sourceOrder = NAV_ITEMS.map((item) => item.to);
			const positions = kept.map((item) => sourceOrder.indexOf(item.to));
			expect(positions.every((p) => p >= 0), `${persona} 出现导航里没有的条目`).toBe(true);
			expect(positions, `${persona} 的条目顺序被打乱`).toEqual([...positions].sort((a, b) => a - b));
			expect(new Set(kept.map((i) => i.to)).size, `${persona} 出现重复条目`).toBe(kept.length);
		}
	});

	it("学生向散条目（无分组）对所有视角可见", () => {
		const ungrouped = NAV_ITEMS.filter((item) => item.group === undefined).map((item) => item.label);
		expect(ungrouped.length).toBeGreaterThan(0);
		for (const persona of PERSONA_ORDER) {
			const labels = labelsOf(persona);
			for (const label of ungrouped) {
				expect(labels, `${persona} 丢了无分组入口 ${label}`).toContain(label);
			}
		}
	});

	it("学生与管理是两条不相交的入口集合（学生不该出现在管理页）", () => {
		const studentTo = new Set(itemsOf("student").map((item) => item.to));
		const adminTo = new Set(itemsOf("admin").map((item) => item.to));
		for (const to of studentTo) {
			if (to.startsWith("/admin")) continue;
			expect(adminTo.has(to), `${to} 在两侧都出现`).toBe(true); // 学生向入口所有视角都有
		}
		const adminOnly = [...adminTo].filter((to) => to.startsWith("/admin"));
		expect(adminOnly.length).toBeGreaterThan(0);
		for (const to of adminOnly) {
			expect(studentTo.has(to), `${to} 不该出现在学生导航`).toBe(false);
		}
	});
});
