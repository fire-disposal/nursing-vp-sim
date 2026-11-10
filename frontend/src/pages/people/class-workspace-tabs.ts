/**
 * 班级工作台的页签 / URL 模型 —— 纯函数，便于直接测「地址栏 ⇄ 视图」的映射。
 *
 * 约定：
 * - `tab` 只有一个真身：地址栏。页面不另存一份本地页签状态，否则刷新、
 *   前进后退、分享链接会与界面不一致（旧实现的 `roleTab` 本地态正是这么分叉的）。
 * - 默认页签（概览）不写进 URL，保持链接干净；非法值按默认处理。
 * - 每个页签各自持有分页/筛选参数，切页签时**只**动 `tab`，其它页签的
 *   offset/搜索词留在 URL 里，返回时自然恢复。
 */

export const CLASS_TABS = ["overview", "members", "assignments", "records"] as const;

export type ClassTab = (typeof CLASS_TABS)[number];

export const DEFAULT_CLASS_TAB: ClassTab = "overview";

export const CLASS_TAB_LABEL: Record<ClassTab, string> = {
	overview: "概览",
	members: "成员",
	assignments: "作业",
	records: "训练记录",
};

/** 成员页的成员角色筛选（学生 / 教师），也只存在于 URL。 */
export const MEMBER_ROLES = ["student", "teacher"] as const;
export type MemberRoleFilter = (typeof MEMBER_ROLES)[number];

export function parseClassTab(raw: string | null | undefined): ClassTab {
	return CLASS_TABS.includes(raw as ClassTab) ? (raw as ClassTab) : DEFAULT_CLASS_TAB;
}

export function parseMemberRole(raw: string | null | undefined): MemberRoleFilter {
	return raw === "teacher" ? "teacher" : "student";
}

/** 训练记录页的状态筛选。空串 = 全部。 */
export const RECORD_STATUS_OPTIONS = [
	{ value: "", label: "全部状态" },
	{ value: "in_progress", label: "进行中" },
	{ value: "completed", label: "已完成" },
	{ value: "abandoned", label: "已放弃" },
] as const;

export function parseRecordStatus(raw: string | null | undefined): string {
	return RECORD_STATUS_OPTIONS.some((o) => o.value === raw) ? (raw ?? "") : "";
}

/** 分页参数：非负整数，非法值回到第一页。 */
export function parseOffset(raw: string | null | undefined): number {
	const value = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 参数字典的键名（写 URL 时统一走这里，避免各页签手抄字符串拼错）。 */
export const CLASS_TAB_PARAMS = {
	members: { role: "member_role", offset: "member_offset", search: "member_search" },
	assignments: { offset: "assignment_offset" },
	records: { offset: "record_offset", status: "record_status" },
} as const;

/** 某页签的「其它页签参数」：切页签时用来判断哪些键该保留（全部保留）。 */
export function tabUrlKeys(tab: ClassTab): string[] {
	switch (tab) {
		case "members":
			return Object.values(CLASS_TAB_PARAMS.members);
		case "assignments":
			return Object.values(CLASS_TAB_PARAMS.assignments);
		case "records":
			return Object.values(CLASS_TAB_PARAMS.records);
		default:
			return [];
	}
}

/**
 * 生成「切到某页签」的查询串：只改 `tab`，其余参数原样保留。
 * 回到默认页签时删掉 `tab`，避免链接里留下 `?tab=overview` 这种噪声。
 */
export function buildTabSearch(
	current: URLSearchParams,
	tab: ClassTab,
): URLSearchParams {
	const next = new URLSearchParams(current);
	if (tab === DEFAULT_CLASS_TAB) next.delete("tab");
	else next.set("tab", tab);
	return next;
}
