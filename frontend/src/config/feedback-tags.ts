export type FeedbackTagColor = "blue" | "red" | "green" | "yellow" | "gray";

/**
 * 反馈标签：后端值 → 展示名 / 配色。
 *
 * 筛选下拉与徽章必须说同一套词——此前「全部/功能/BUG…」的选项表、徽章词表、
 * 配色表在管理页与学生页各写了一遍（同一映射四份），改一处就会漏一处。
 */
export const FEEDBACK_TAGS: { value: string; label: string; color: FeedbackTagColor }[] = [
	{ value: "feature", label: "功能建议", color: "blue" },
	{ value: "bug", label: "BUG反馈", color: "red" },
	{ value: "experience", label: "体验评价", color: "green" },
	{ value: "content", label: "内容质量", color: "yellow" },
	{ value: "ui", label: "界面设计", color: "blue" },
	{ value: "other", label: "其他", color: "gray" },
];

const BY_VALUE = new Map(FEEDBACK_TAGS.map((tag) => [tag.value, tag]));

/** 筛选下拉的选项（不含「全部」；清空即全部） */
export const TAG_FILTER_OPTIONS = FEEDBACK_TAGS.map((tag) => ({ value: tag.value, label: tag.label }));

export function tagLabel(value: string): string {
	return BY_VALUE.get(value)?.label ?? value;
}

export function tagColor(value: string): FeedbackTagColor {
	return BY_VALUE.get(value)?.color ?? "gray";
}

/** 回复状态筛选的选项 */
export const REPLY_FILTER_OPTIONS = [
	{ value: "replied", label: "已回复" },
	{ value: "unreplied", label: "未回复" },
];

/** 带「全部」项（不可清空的窄栏位用） */
export const REPLY_FILTER_OPTIONS_WITH_ALL = [{ value: "", label: "全部" }, ...REPLY_FILTER_OPTIONS];

/** 回复状态三态（全部/已回复/未回复）↔ 后端布尔参数 */
export function repliedToUi(replied: boolean | null | undefined): string {
	if (replied === true) return "replied";
	if (replied === false) return "unreplied";
	return "";
}

export function uiToReplied(value: string): boolean | undefined {
	if (value === "replied") return true;
	if (value === "unreplied") return false;
	return undefined;
}
