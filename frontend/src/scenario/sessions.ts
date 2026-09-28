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
 * 不一律写"进行中"——回合数为 0 与做到一半不是一回事，写成一个词等于骗学生
 * （会话只有显式结算才会变 `completed`）。回合数是**学生真的动过几次**（后端按事件流算，
 * 开场那回合是 DM 立的，不算他动过），所以 0 回合才写「未开始」。
 * 后端只给状态与回合数，这里也只说这两件事，不自己造"搁置"这类阈值。
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

/** 「我的情境经历」里的一行：单条病例，或者**连续同名**的几条（默认折成一行）。 */
export interface ScenarioSessionGroup {
	/** React key：这一组最新一条的 id（同一行只会出现一次）。 */
	id: number;
	title: string;
	/** 组内的几条，仍是"最近的在前"（与后端给的顺序一致，不重排）。 */
	rows: ScenarioSessionRow[];
	/** 最新的一条——折叠行显示它的状态与时间。 */
	latest: ScenarioSessionRow;
}

/**
 * 把「我的情境经历」按**连续同名**病例分组：同名且挨着的几条并成一组，其余各自成组。
 *
 * 只做相邻折叠：**不跨行重排**（同名但中间夹着别的病例就是两组）。同一个病例反复练是常态
 * （8 行里 6 行同一个病例），逐行铺开等于把入口页变成噪声；折起来之后每一组仍然是
 * 原来那几条，点开就回到它们本身——单条的含义与状态文案一个字都不改。
 */
export function groupConsecutiveSessions(
	rows: ScenarioSessionRow[],
): ScenarioSessionGroup[] {
	const groups: ScenarioSessionGroup[] = [];
	for (const row of rows) {
		const last = groups[groups.length - 1];
		if (last !== undefined && last.title === row.pack_title) {
			last.rows.push(row);
			continue;
		}
		groups.push({
			id: row.id,
			title: row.pack_title,
			rows: [row],
			latest: row,
		});
	}
	return groups;
}
