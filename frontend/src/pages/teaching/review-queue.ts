export interface ReviewQueueItem {
	id: number;
	score_reviewed: boolean;
}

/**
 * 批改工作台的下一份：从当前行往后找第一条未复核的记录，到末尾后绕回开头。
 * 跳过当前记录本身（刚提交的那条在列表刷新前仍标记为未复核）。
 */
export function nextPendingId(records: readonly ReviewQueueItem[], currentId: number): number | null {
	const index = records.findIndex((r) => r.id === currentId);
	const ordered = index >= 0 ? [...records.slice(index + 1), ...records.slice(0, index)] : [...records];
	const next = ordered.find((r) => r.id !== currentId && !r.score_reviewed);
	return next?.id ?? null;
}
