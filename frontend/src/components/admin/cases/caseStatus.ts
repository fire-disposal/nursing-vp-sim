/** 病例生命周期展示口径（docs/15 §六）：status = draft | published | archived。 */

export const CASE_STATUS_META: Record<string, { label: string; color: string }> = {
	draft: { label: "草稿", color: "gray" },
	published: { label: "已发布", color: "green" },
	archived: { label: "已归档", color: "orange" },
};

/** 状态筛选下拉：``all`` = 全部（后端缺省不含归档）。 */
export const CASE_STATUS_FILTER_OPTIONS = [
	{ value: "all", label: "全部状态" },
	{ value: "draft", label: "草稿" },
	{ value: "published", label: "已发布" },
	{ value: "archived", label: "已归档" },
] as const;

/** 未知状态回显原值，避免静默显示为空。 */
export function caseStatusLabel(status: string | null | undefined): string {
	if (!status) return "未知";
	return CASE_STATUS_META[status]?.label ?? status;
}
