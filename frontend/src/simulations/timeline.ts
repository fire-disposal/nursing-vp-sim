/** 班次时间轴（Shift Timeline）— 结构化、可交互的时间模型。
 *
 * 纯函数，无 React：返回模型（地平线/刻度/光标百分比/过去标记/待返回检查），
 * 由 SimTimeline.tsx 渲染为可视化时间带。墙钟标签遵循后端「分片化时间」
 * （case start_clock），与消息时间一致。
 *
 * 设计要点：
 * - 地平线自适应：至少 120min，且确保「当前 + 60min」与「最晚待返回检查 + 30min」
 *   落在带内（向上取整到 30min，封顶 360min），长局/多 pending 不拥挤；
 * - 过去标记：来自玩家已见 transcript（评估/检查/报警/恶化），按分钟去重、高优先级胜出；
 * - 待返回检查：来自 snapshot.pending（玩家已知），渲染为未来琥珀标记，点击可等待。
 */

export interface TimelineEvent {
	atMinute?: number;
	msgKind?: string;
	text?: string;
}

export interface PendingLabEvent {
	due_at: number;
	due_clock?: string;
	label?: string;
	kind?: string;
	id?: string;
}

export interface TimelineTick {
	label: string;
	minute: number;
}

export interface TimelineMarker {
	id: string;
	minute: number;
	/** past（已发生）| pending-lab（待返回检查）。 */
	kind: "past" | "pending-lab";
	/** 悬浮/图例展示文本。 */
	label: string;
	/** 过去标记的视觉类别（评估/检查/报警/恶化）。 */
	mark?: string;
	/** 待返回检查的等待目标（lab kind，大写）。 */
	labKind?: string;
}

export interface TimelineModel {
	startClock: string;
	endClock: string;
	currentMinute: number;
	horizon: number;
	cursorPct: number;
	ticks: TimelineTick[];
	past: TimelineMarker[];
	pending: TimelineMarker[];
}

export const MIN_HORIZON = 120;
export const MAX_HORIZON = 360;
export const TICK_STEP = 30;

/** 时钟标签（分片化：start_clock + game minute）。 */
export function clockText(minute: number, startClock = "08:30"): string {
	const [hh, mm] = startClock.split(":").map(Number);
	const total = hh * 60 + mm + minute;
	return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** 地平线：至少 120min，覆盖「当前+60」与「最晚待返回+30」，向上取整 30min，封顶 360min。 */
export function computeHorizon(currentMinute: number, maxPendingDue: number): number {
	const need = Math.max(currentMinute + 60, maxPendingDue + 30);
	return Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, Math.ceil(need / TICK_STEP) * TICK_STEP));
}

/** 过去标记的展示字符与优先级（同分钟共享一格时高优先级胜出）。 */
export const MARK_STYLE: Record<string, { mark: string; rank: number }> = {
	ASSESSMENT: { mark: "●", rank: 1 },
	LAB: { mark: "◆", rank: 2 },
	MONITOR: { mark: "◇", rank: 3 },
	CRITICAL: { mark: "▲", rank: 4 },
	AUDIT: { mark: "▲", rank: 4 },
};

export const TIMELINE_LEGEND = "●评估 ◆检查 ◇报警 ▲恶化/结局 · 琥珀标记＝待返回检查（点击等待）";

/** 把已见 transcript 折叠为「每分钟一个、最高可见度胜出」的过去标记。 */
function buildPastMarkers(events: TimelineEvent[]): TimelineMarker[] {
	const perMinute = new Map<number, TimelineMarker>();
	for (const ev of events) {
		if (ev.atMinute == null) continue;
		const style = ev.msgKind ? MARK_STYLE[ev.msgKind] : undefined;
		if (!style) continue;
		const prev = perMinute.get(ev.atMinute);
		if (prev === undefined || style.rank > (MARK_STYLE[prev.mark ?? ""]?.rank ?? 0)) {
			perMinute.set(ev.atMinute, {
				id: `past-${ev.atMinute}-${style.mark}`,
				minute: ev.atMinute,
				kind: "past",
				label: ev.text ?? ev.msgKind ?? "",
				mark: style.mark,
			});
		}
	}
	return [...perMinute.values()].sort((a, b) => a.minute - b.minute);
}

export function buildTimelineModel(
	events: TimelineEvent[],
	pending: PendingLabEvent[],
	currentMinute: number,
	startClock = "08:30",
): TimelineModel {
	const maxDue = pending.reduce((m, p) => Math.max(m, p.due_at ?? 0), 0);
	const horizon = computeHorizon(currentMinute, maxDue);
	const pendingMarkers = pending
		.filter((p) => p.due_at != null)
		.map((p) => ({
			id: `pending-${p.id ?? p.kind ?? p.due_at}`,
			minute: Math.min(p.due_at, horizon), // 超出地平线则钳到带尾
			kind: "pending-lab" as const,
			label: `${p.label ?? p.kind ?? "检查"} 预计 ${p.due_clock ?? clockText(p.due_at, startClock)} 返回`,
			labKind: p.kind,
		}))
		.sort((a, b) => a.minute - b.minute);

	const ticks: TimelineTick[] = [];
	for (let m = 0; m <= horizon; m += TICK_STEP) {
		ticks.push({ label: clockText(m, startClock), minute: m });
	}

	return {
		startClock,
		endClock: clockText(horizon, startClock),
		currentMinute,
		horizon,
		cursorPct: Math.min(100, (currentMinute / horizon) * 100),
		ticks,
		past: buildPastMarkers(events),
		pending: pendingMarkers,
	};
}

/** 标记在时间带上的横向百分比（0..100）。 */
export function markerPct(marker: TimelineMarker, horizon: number): number {
	return Math.min(100, (marker.minute / horizon) * 100);
}

/** 悬浮文本（过去标记截断到单行）。 */
export function markerTitle(marker: TimelineMarker): string {
	return marker.label.replace(/\s+/g, " ").slice(0, 120);
}
