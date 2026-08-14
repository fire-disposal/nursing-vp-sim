/** 班次时间轴组件 — 渲染 TimelineModel 为可视化时间带。
 *
 * - 时间带：过去段（已填充）+ 未来段，当前光标（带过渡动画，等待后可见时间流逝）；
 * - 过去标记：评估/检查/报警/恶化（悬浮显示原文摘要）；
 * - 待返回检查：琥珀色标记 + 「进行中检查」chips 行，点击即等待该检查（/wait <lab>）。
 * 全部数据来自后端快照（pending.due_at/due_clock/label）与已见 transcript，无隐藏信息。
 */

import type { TimelineModel } from "./timeline";
import { TIMELINE_LEGEND, clockText, markerPct, markerTitle } from "./timeline";

const PAST_CLASS: Record<string, string> = {
	"●": "tl-past-assess",
	"◆": "tl-past-lab",
	"◇": "tl-past-alert",
	"▲": "tl-past-critical",
};

export default function SimTimeline({
	model,
	busy,
	onWaitLab,
}: {
	model: TimelineModel;
	busy: boolean;
	onWaitLab: (kind: string) => void;
}) {
	const { horizon, ticks, past, pending, cursorPct, startClock, currentMinute } = model;
	// 同分钟重叠的待返回标记：按出现次序做纵向微偏移。
	const perMinuteCount = new Map<number, number>();
	const pendingWithOffset = pending.map((p) => {
		const count = perMinuteCount.get(p.minute) ?? 0;
		perMinuteCount.set(p.minute, count + 1);
		return { marker: p, offset: count * 6 };
	});

	return (
		<fieldset className="tl-wrap">
			<legend className="tl-legend">{TIMELINE_LEGEND}</legend>
			<div className="tl-band">
				<div className="tl-track">
					<div className="tl-elapsed" style={{ width: `${cursorPct}%` }} />
					{past.map((m) => (
						<span
							key={m.id}
							className={`tl-m tl-past ${PAST_CLASS[m.mark ?? ""] ?? "tl-past-assess"}`}
							style={{ left: `${markerPct(m, horizon)}%` }}
							title={markerTitle(m)}
						>
							{m.mark ?? "●"}
						</span>
					))}
					{pendingWithOffset.map(({ marker, offset }) => (
						<button
							key={marker.id}
							type="button"
							className="tl-m tl-lab"
							style={{ left: `${markerPct(marker, horizon)}%`, marginTop: offset }}
							title={markerTitle(marker)}
							aria-label={marker.label}
							disabled={busy}
							onClick={() => onWaitLab(marker.labKind ?? "")}
						>
							◆
						</button>
					))}
					<div
						className="tl-now"
						style={{ left: `${cursorPct}%` }}
						title={`当前 ${clockText(currentMinute, startClock)}`}
					>
						<span className="tl-nowline" />
					</div>
				</div>
				<div className="tl-ticks">
					{ticks.map((t, i) => (
						<span
							key={t.minute}
							className={`tl-tick${i === 0 ? " tl-tick-first" : i === ticks.length - 1 ? " tl-tick-last" : ""}`}
							style={{ left: `${(t.minute / horizon) * 100}%` }}
						>
							{t.label}
						</span>
					))}
				</div>
			</div>
			{pending.length > 0 ? (
				<div className="tl-chips">
					{pending.map((p) => (
						<button
							key={p.id}
							type="button"
							className="tl-chip"
							disabled={busy}
							onClick={() => onWaitLab(p.labKind ?? "")}
							title="等待该检查返回（可被更早事件打断）"
						>
							<span className="tl-chip-name">{p.label}</span>
							<span className="tl-chip-act">等待 →</span>
						</button>
					))}
				</div>
			) : null}
		</fieldset>
	);
}
