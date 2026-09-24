/**
 * 问诊进度匹配 — 移植自本系统首个提交（v0 ChatTraining.jsx InquirySidebar）。
 * 双字 bigram 滑窗：问诊项去括号后取全部相邻 2 字 token，
 * 任一 token 出现在学生全部发言拼接文本中即视为该项已覆盖。
 * 宽松匹配、仅供参考，用于实时引导而非评分。
 */

export function extractKeywords(inquiry: string): string[] {
	const cleaned = inquiry.replace(/[（）()]/g, " ");
	const tokens: string[] = [];
	for (let i = 0; i < cleaned.length - 1; i++) {
		tokens.push(cleaned.slice(i, i + 2));
	}
	return [...new Set(tokens.filter((t) => t.trim().length === 2))];
}

export function getInquiryLabel(inquiry: string): string {
	return inquiry.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").slice(0, 18);
}

/** 返回已覆盖项的索引集合 */
export function computeCovered(inquiries: string[], studentText: string): Set<number> {
	const result = new Set<number>();
	if (!studentText) return result;
	inquiries.forEach((inquiry, idx) => {
		const keywords = extractKeywords(inquiry);
		if (keywords.length > 0 && keywords.some((kw) => studentText.includes(kw))) {
			result.add(idx);
		}
	});
	return result;
}

/** 任务清单完成度分档（沿用 v0）：<40 红 / <80 琥珀 / >=80 绿 */
export type ProgressBand = "danger" | "warning" | "success";

export function progressColor(pct: number): ProgressBand {
	if (pct >= 80) return "success";
	if (pct >= 40) return "warning";
	return "danger";
}

/** 分档 → Mantine 语义色名（用于 `c` / `color`）。 */
export const PROGRESS_TEXT: Record<ProgressBand, string> = {
	success: "green",
	warning: "yellow",
	danger: "red",
};

/** 分档 → CSS 颜色值（用于内联 background）。 */
export const PROGRESS_BG: Record<ProgressBand, string> = {
	success: "var(--mantine-color-green-6)",
	warning: "var(--mantine-color-yellow-6)",
	danger: "var(--mantine-color-red-6)",
};

