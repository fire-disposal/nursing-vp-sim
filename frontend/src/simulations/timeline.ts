/** Terminal-style timeline: a fixed-width monospace bar spanning the case's
 * horizon, with event markers derived from the player's seen transcript.
 *
 * Pure function, no React — the console just renders the strings. The wall
 * clock labels are case-aware (start_clock), matching the backend's
 * 分片化时间 model.
 */

export interface TimelineEvent {
	atMinute?: number;
	msgKind?: string;
}

const MARKER_BY_KIND: Record<string, string> = {
	ASSESSMENT: "●",
	LAB: "◆",
	MONITOR: "◇",
	CRITICAL: "▲",
	AUDIT: "▲",
};

const RANK: Record<string, number> = { "▲": 4, "◇": 3, "◆": 2, "●": 1 };

export const TIMELINE_LEGEND = "●评估 ◆检查 ◇报警 ▲恶化/结局 ▸当前";
export const HORIZON_MIN = 120; // case horizon in game minutes
export const BAR_CHARS = 36;

/** 分片化：起始墙钟标签（如 "22:00"）+ 游戏分钟 → 结束墙钟标签。 */
export function horizonLabels(startClock = "08:30"): { start: string; end: string } {
	const [hh, mm] = startClock.split(":").map(Number);
	const total = hh * 60 + mm + HORIZON_MIN;
	const end = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
	return { start: startClock, end };
}

export function buildTimeline(
	events: TimelineEvent[],
	currentMinute: number,
	startClock = "08:30",
): {
	bar: string;
	cursor: string;
} {
	// First marker per minute, highest-visibility kind wins in a shared cell.
	const markers = new Map<number, string>();
	for (const ev of events) {
		if (ev.atMinute == null) continue;
		const mk = ev.msgKind ? MARKER_BY_KIND[ev.msgKind] : undefined;
		if (!mk) continue;
		const prev = markers.get(ev.atMinute);
		if (prev === undefined || (RANK[mk] ?? 0) > (RANK[prev] ?? 0)) {
			markers.set(ev.atMinute, mk);
		}
	}
	const scale = HORIZON_MIN / BAR_CHARS;
	const cells = new Array<string>(BAR_CHARS).fill("─");
	for (const [minute, mk] of markers) {
		const idx = Math.min(BAR_CHARS - 1, Math.floor(minute / scale));
		const existing = cells[idx];
		if (existing === "─" || (RANK[mk] ?? 0) > (RANK[existing] ?? 0)) {
			cells[idx] = mk;
		}
	}
	const cursorIdx = Math.min(BAR_CHARS - 1, Math.floor(currentMinute / scale));
	const labelPad = `${startClock} `.length;
	return {
		bar: cells.join(""),
		cursor: `${" ".repeat(labelPad + cursorIdx)}▸`,
	};
}
