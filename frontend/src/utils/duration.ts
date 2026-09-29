import type { components } from "@/api/api-types.gen";

/**
 * 时长展示：**一处实现**（记录列表 / 教师记录页 / 趋势图都用它）。
 *
 * 两种输入对应两种事实，别混：
 * - 记录（起止时间）→ 分钟数；未结束（没 `end_time`）返回 `null`，由调用方决定写什么
 *   （"进行中"与"0 分钟"不是一回事）。
 * - 服务端已经算好的**秒数** → 可读串（`1小时2分` / `3分20秒` / `45秒`）。
 */

type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];

/** 训练记录时长（分钟，四舍五入）；没有 `end_time` 就是还没结束 → `null`。 */
export function recordDurationMinutes(r: TrainingRecordBrief): number | null {
	if (!r.end_time) return null;
	return Math.round(
		(new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000,
	);
}

/** 秒 → 可读时长；缺失或负数给 `-`（不假装 0 秒）。 */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds == null || seconds < 0) return "-";
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}小时${m}分`;
	if (m > 0) return `${m}分${s}秒`;
	return `${s}秒`;
}
