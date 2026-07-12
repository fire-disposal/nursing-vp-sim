const REASON_LABELS: Record<string, string> = {
	rate_limited: "限流",
	consecutive_failures: "连续失败",
	cost_exceeded: "超预算",
};

export function degradedReasonLabel(reason: string | null | undefined): string {
	return (reason && REASON_LABELS[reason]) || "降级";
}

export function statusText(status: string | null | undefined): string {
	if (status === "active") return "正常";
	if (status === "degraded") return "熔断";
	return "停用";
}

/** 熔断恢复文本。cost_exceeded 到下月 → "下月恢复"；否则按剩余秒/分钟。 */
export function recoveryText(
	degradedUntil: string | null | undefined,
	reason: string | null | undefined,
	now: Date = new Date(),
): string {
	if (!degradedUntil) return "";
	const until = new Date(degradedUntil).getTime();
	const diffMs = until - now.getTime();
	if (Number.isNaN(until) || diffMs <= 0) return "";
	if (reason === "cost_exceeded") return "下月恢复";
	const secs = Math.round(diffMs / 1000);
	if (secs < 90) return `约 ${secs}s 后恢复`;
	return `约 ${Math.round(secs / 60)} 分钟后恢复`;
}

/** 成本颜色：>=limit 红，>=90% 琥珀，否则常规；无 limit 常规。 */
export function costColorClass(
	used: number,
	limit: number | null | undefined,
): string {
	if (!limit || limit <= 0) return "";
	if (used >= limit) return "text-danger-foreground";
	if (used >= 0.9 * limit) return "text-warning-foreground";
	return "";
}
