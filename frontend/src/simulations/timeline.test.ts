import { describe, expect, it } from "vitest";
import { BAR_CHARS, buildTimeline } from "./timeline";

describe("buildTimeline", () => {
	it("renders an empty bar with the cursor at the start", () => {
		const { bar, cursor } = buildTimeline([], 0);
		expect(bar).toBe("─".repeat(BAR_CHARS));
		expect(cursor).toBe("      ▸"); // 6-space label pad + position 0
	});

	it("places markers at the right cells for their minute", () => {
		const { bar } = buildTimeline(
			[
				{ atMinute: 6, msgKind: "ASSESSMENT" }, // cell 1 (scale 3.33)
				{ atMinute: 24, msgKind: "MONITOR" }, // cell 7
			],
			24,
		);
		expect(bar[1]).toBe("●");
		expect(bar[7]).toBe("◇");
		expect(bar[0]).toBe("─");
		expect(bar[35]).toBe("─");
	});

	it("moves the cursor to the current minute", () => {
		const { cursor } = buildTimeline([], 24);
		expect(cursor).toBe(`${" ".repeat(6 + 7)}▸`);
	});

	it("lets critical markers win shared cells", () => {
		const { bar } = buildTimeline(
			[
				{ atMinute: 6, msgKind: "ASSESSMENT" },
				{ atMinute: 6, msgKind: "CRITICAL" },
			],
			0,
		);
		expect(bar[1]).toBe("▲");
	});

	it("dedupes events on the same minute", () => {
		const { bar } = buildTimeline(
			[
				{ atMinute: 12, msgKind: "LAB" },
				{ atMinute: 12, msgKind: "LAB" },
			],
			0,
		);
		const markers = [...bar].filter((c) => c !== "─");
		expect(markers).toEqual(["◆"]);
	});

	it("clamps markers and cursor at the horizon", () => {
		const { bar, cursor } = buildTimeline([{ atMinute: 200, msgKind: "AUDIT" }], 200);
		expect(bar[BAR_CHARS - 1]).toBe("▲");
		expect(cursor.endsWith("▸")).toBe(true);
	});
});
