import type { ScenarioSessionRow } from "@/api/scenario";

/**
 * 会话状态与结算摘要的读法：学生侧"我的情境经历"与管理侧会话列表用同一份，
 * 两处各写一遍必然有一处先说错话。
 */

const STATUS_LABEL: Record<string, string> = {
	active: "进行中",
	completed: "已结算",
};

/** 未知状态原样显示（后端加状态时界面不该静默吞掉）。 */
export function sessionStatusLabel(status: string): string {
	return STATUS_LABEL[status] ?? status;
}

const ANCHOR_LABEL: Record<string, string> = {
	strong: "强",
	adequate: "合格",
	missed: "漏",
};

/** 结算摘要（`report.summary`）→ 一行读数；未结算时返回空串。 */
export function summaryText(summary: Record<string, number> | null): string {
	if (!summary) return "";
	return ["strong", "adequate", "missed"]
		.map((anchor) => `${ANCHOR_LABEL[anchor]} ${summary[anchor] ?? 0}`)
		.join(" · ");
}

/** 一行里能说清的一切：状态 + 回合 + 结局 + 摘要。 */
export function sessionRowMeta(row: ScenarioSessionRow): string {
	const parts = [sessionStatusLabel(row.status)];
	if (row.turn !== null && row.turn !== undefined) parts.push(`${row.turn} 回合`);
	if (row.lost) parts.push("不可逆结局");
	const summary = summaryText(row.summary);
	if (summary) parts.push(summary);
	return parts.join(" · ");
}
