import { describe, expect, it } from "vitest";
import {
	MIN_HORIZON,
	buildTimelineModel,
	clockText,
	computeHorizon,
	markerPct,
	markerTitle,
} from "./timeline";

describe("clockText (分片化时间)", () => {
	it("maps game minutes to the case wall clock", () => {
		expect(clockText(0, "08:30")).toBe("08:30");
		expect(clockText(60, "08:30")).toBe("09:30");
		expect(clockText(60, "22:00")).toBe("23:00");
		expect(clockText(120, "22:00")).toBe("00:00");
	});
});

describe("computeHorizon", () => {
	it("never goes below the minimum horizon", () => {
		expect(computeHorizon(0, 0)).toBe(MIN_HORIZON);
		expect(computeHorizon(10, 20)).toBe(MIN_HORIZON);
	});

	it("extends for a late current time so 'now' is not crammed at the end", () => {
		// 当前 100 → 需要 160 → 向上取整 180
		expect(computeHorizon(100, 0)).toBe(180);
	});

	it("extends for a far-due pending lab so it stays visible ahead", () => {
		// 最晚待返回 150 → 需要 180
		expect(computeHorizon(0, 150)).toBe(180);
	});

	it("combines both needs and rounds up to 30-minute steps", () => {
		expect(computeHorizon(95, 140)).toBe(180); // max(155, 170) → 180
		expect(computeHorizon(20, 45)).toBe(120);
	});

	it("caps at the maximum horizon", () => {
		expect(computeHorizon(400, 500)).toBe(360);
	});
});

describe("buildTimelineModel", () => {
	it("renders an empty model with cursor at the start", () => {
		const m = buildTimelineModel([], [], 0, "08:30");
		expect(m.horizon).toBe(MIN_HORIZON);
		expect(m.cursorPct).toBe(0);
		expect(m.past).toEqual([]);
		expect(m.pending).toEqual([]);
		expect(m.startClock).toBe("08:30");
		expect(m.endClock).toBe("10:30");
		// 每 30min 一刻度：0..120 → 5 个
		expect(m.ticks.map((t) => t.label)).toEqual(["08:30", "09:00", "09:30", "10:00", "10:30"]);
	});

	it("maps past events to one marker per minute, highest visibility wins", () => {
		const m = buildTimelineModel(
			[
				{ atMinute: 6, msgKind: "ASSESSMENT", text: "生命体征（08:36）：HR 84。" },
				{ atMinute: 6, msgKind: "CRITICAL", text: "恶化。" },
				{ atMinute: 24, msgKind: "MONITOR", text: "报警。" },
			],
			[],
			30,
		);
		expect(m.past.map((p) => p.minute)).toEqual([6, 24]);
		expect(m.past[0].mark).toBe("▲"); // CRITICAL 胜出共享格
		expect(markerTitle(m.past[0])).toContain("恶化");
	});

	it("positions pending labs as future markers with wait targets", () => {
		const m = buildTimelineModel(
			[],
			[
				{ id: "cbc-1", kind: "CBC", label: "血常规(CBC)", due_at: 20, due_clock: "08:50" },
			],
			5,
			"08:30",
		);
		expect(m.pending).toHaveLength(1);
		const lab = m.pending[0];
		expect(lab.kind).toBe("pending-lab");
		expect(lab.labKind).toBe("CBC");
		expect(lab.label).toContain("血常规(CBC)");
		expect(lab.label).toContain("08:50");
		expect(markerPct(lab, m.horizon)).toBeCloseTo((20 / 120) * 100);
	});

	it("clamps a pending lab beyond the horizon to the band end", () => {
		const m = buildTimelineModel(
			[],
			[{ id: "abg-1", kind: "ABG", label: "动脉血气(ABG)", due_at: 500, due_clock: "16:50" }],
			0,
			"08:30",
		);
		expect(m.horizon).toBe(360); // 封顶
		expect(m.pending[0].minute).toBe(360);
		expect(markerPct(m.pending[0], m.horizon)).toBe(100);
	});

	it("moves the cursor percentage with the current minute", () => {
		const m = buildTimelineModel([], [], 60, "08:30");
		expect(m.cursorPct).toBe(50);
	});

	it("ignores events without a minute or a known kind", () => {
		const m = buildTimelineModel(
			[{ msgKind: "ASSESSMENT" }, { atMinute: 5, msgKind: "TALK" }],
			[],
			0,
		);
		expect(m.past).toEqual([]);
	});
});
