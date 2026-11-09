import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/shell/navigation";
import { PERMISSION_KEYS } from "@/config/permissions.gen";

/**
 * 角色 → 导航入口的**契约**（与后端 `core/personas.py` 的视角预设对齐）。
 *
 * 目的不是"多测几个字符串"，而是钉住"每种角色所需的功能都是完整的、且在导航里看得见"：
 * - 新增页面忘了配 `nav`（功能做了但没人找得到）；
 * - 改了路由权限却没同步角色（入口消失或点进去 403）；
 * - 把某个入口挪进分组时漏掉某个角色。
 *
 * 期望列表就是"这个角色用得到什么"的书面口径；角色策略变化时同步改这里。
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
	// 平台账号 = 全部权限（由 PERMISSION_KEYS 派生，代码不再手抄）
	student: ["training_access", "qa_access"],
	teacher: [
		"grade_class_manage",
		"case_manage",
		"score_review",
		"stats_view",
		"assignment_manage",
		"feedback_review",
		"export_data",
		"questionnaire_manage",
	],
	admin: [
		"user_manage",
		"role_manage",
		"grade_class_manage",
		"case_manage",
		"score_review",
		"stats_view",
		"llm_monitor",
		"assignment_manage",
		"feedback_review",
		"export_data",
		"questionnaire_manage",
	],
};

function visibleLabels(permissions: string[], isPlatform = false): string[] {
	const all = isPlatform ? ALL_PERMISSIONS : permissions;
	return NAV_ITEMS.filter((item) => !item.permission || all.includes(item.permission))
		.map((item) => item.label)
		.sort();
}

const ALL_PERMISSIONS: string[] = [...PERMISSION_KEYS];

describe("角色导航矩阵", () => {
	it("学生：训练 / 病例 / 作业 / 记录 / 问答 / 我的", () => {
		expect(visibleLabels(ROLE_PERMISSIONS.student)).toEqual(
			["我的", "问答", "记录", "训练", "病例", "作业"].sort(),
		);
	});

	it("教师：看板 + 批阅 + 作业 + 成绩 + 病例/问卷/标准 + 系统反馈", () => {
		expect(visibleLabels(ROLE_PERMISSIONS.teacher)).toEqual(
			[
				"我的",
				"教学看板",
				"训练记录",
				"批改工作台",
				"作业管理",
				"成绩管理",
				"班级管理",
				"病例库",
				"问卷管理",
				"评分标准",
				"系统反馈",
			].sort(),
		);
	});

	it("院校管理员：教师全部 + 用户管理 + 成本/密钥（不含平台级管理）", () => {
		const admin = visibleLabels(ROLE_PERMISSIONS.admin);
		expect(admin).toContain("用户管理");
		expect(admin).toContain("成本管理");
		expect(admin).toContain("API 密钥");
		expect(admin).toContain("视角管理");
		// 平台级能力不应出现在院校管理员导航里
		for (const platformOnly of ["院校管理", "审计日志", "系统通知", "运维仪表盘", "版本归因"]) {
			expect(admin).not.toContain(platformOnly);
		}
	});

	it("平台超管：所有带导航的页面都可见", () => {
		const expected = NAV_ITEMS.map((item) => item.label).sort();
		expect(visibleLabels([], true)).toEqual(expected);
	});

	it("移动端：学生轨与教师轨的底部 Tab 都非空", () => {
		const tabs = NAV_ITEMS.filter((item) => item.mobile);
		expect(tabs.some((t) => t.mobile?.tier === "student")).toBe(true);
		expect(tabs.some((t) => t.mobile?.tier === "staff")).toBe(true);
	});
});
