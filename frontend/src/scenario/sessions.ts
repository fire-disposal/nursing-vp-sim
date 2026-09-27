import type { ScenarioSessionRow } from "@/api/scenario";
import { formatShortDateTime } from "@/utils/date";

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

/**
 * 学生面的一行说明：**诚实的进度** + 最后活动。
 *
 * 不一律写"进行中"——从来没有开过场的会话（0 回合）和做到一半的会话不是一回事，
 * 写成一个词等于骗学生（会话只有显式结算才会变 `completed`）。
 * 后端只给状态与回合数，所以这里也只说这两件事，不自己造"搁置"这类阈值。
 */
export function sessionRowMeta(row: ScenarioSessionRow): string {
	const status =
		row.status === "active"
			? row.turn
				? "未结算"
				: "未开始"
			: "已结束";
	const parts = [status];
	if (row.turn) parts.push(`第 ${row.turn} 回合`);
	if (row.lost) parts.push("不可逆结局");
	const summary = summaryText(row.summary);
	if (summary) parts.push(summary);
	parts.push(
		`最后活动 ${formatShortDateTime(row.updated_at ?? row.created_at)}`,
	);
	return parts.join(" · ");
}
