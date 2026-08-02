import { describe, expect, it } from "vitest";
import { NEUTRAL_EXTRAS, premiumExtrasFrom4D, type PremiumExtras } from "./premiumExtras";
import type { EmotionValues } from "./expressionMap";

const MID: EmotionValues = { trust: 0.5, anxiety: 0.3, irritation: 0.2, cooperation: 0.6 };

const LABELS = [
	"open_trusting",
	"trusting_anxious",
	"irritated",
	"anxious_cooperative",
	"anxious_guarded",
	"withdrawn",
	"defensive",
	"relaxed",
	"neutral",
] as const;

describe("premiumExtrasFrom4D", () => {
	it("maps every label deterministically", () => {
		for (const label of LABELS) {
			expect(premiumExtrasFrom4D(label, MID)).toEqual(premiumExtrasFrom4D(label, MID));
		}
	});

	it("neutral yields the neutral extras", () => {
		expect(premiumExtrasFrom4D("neutral", MID)).toEqual(NEUTRAL_EXTRAS);
	});

	it("anxious labels get sweat", () => {
		expect(premiumExtrasFrom4D("anxious_cooperative", MID).sweat).toBe(true);
		expect(premiumExtrasFrom4D("anxious_guarded", MID).sweat).toBe(true);
	});

	it("tense labels get furrow and lid press", () => {
		expect(premiumExtrasFrom4D("irritated", MID).furrow).toBe(true);
		expect(premiumExtrasFrom4D("irritated", MID).eyeLid).toBeGreaterThan(0.4);
		expect(premiumExtrasFrom4D("defensive", MID).furrow).toBe(true);
	});

	it("withdrawn tilts head down and looks down", () => {
		const e = premiumExtrasFrom4D("withdrawn", MID);
		expect(e.headTilt).toBeLessThan(0);
		expect(e.irisShift).toBe("down");
	});

	it("numeric extremes override label defaults", () => {
		const e = premiumExtrasFrom4D("neutral", { ...MID, anxiety: 0.9 });
		expect(e.sweat).toBe(true);
		const f = premiumExtrasFrom4D("neutral", { ...MID, irritation: 0.9 });
		expect(f.furrow).toBe(true);
		expect(f.eyeLid).toBeGreaterThanOrEqual(0.5);
	});

	it("low trust + low cooperation turns gaze away", () => {
		const e = premiumExtrasFrom4D("neutral", { ...MID, trust: 0.1, cooperation: 0.1 });
		expect(e.irisShift).toBe("away");
	});

	it("unknown label falls back to neutral", () => {
		expect(premiumExtrasFrom4D("legacy_label" as never, MID)).toEqual(NEUTRAL_EXTRAS);
	});

	it("does not mutate the neutral baseline", () => {
		premiumExtrasFrom4D("withdrawn", MID);
		expect(NEUTRAL_EXTRAS).toEqual({
			headTilt: 0,
			sweat: false,
			furrow: false,
			irisShift: "center",
			eyeLid: 0,
		} satisfies PremiumExtras);
	});
});
