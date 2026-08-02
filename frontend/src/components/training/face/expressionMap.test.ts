import { describe, expect, it } from "vitest";
import {
	NEUTRAL_FACE,
	faceConfigFrom4D,
	type EmotionValues,
} from "./expressionMap";

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

const MID: EmotionValues = { trust: 0.5, anxiety: 0.3, irritation: 0.2, cooperation: 0.6 };

describe("faceConfigFrom4D", () => {
	it("maps every 4D label deterministically", () => {
		for (const label of LABELS) {
			const a = faceConfigFrom4D(label, MID);
			const b = faceConfigFrom4D(label, MID);
			expect(a).toEqual(b);
			expect(a.mouth).toMatch(/smile|flat|frown|tight|open/);
			expect(a.eyeOpenness).toBeGreaterThanOrEqual(0);
			expect(a.eyeOpenness).toBeLessThanOrEqual(1);
		}
	});

	it("neutral label yields the neutral config", () => {
		expect(faceConfigFrom4D("neutral", MID)).toEqual(NEUTRAL_FACE);
	});

	it("irritated label + extreme irritation forces brow down", () => {
		const cfg = faceConfigFrom4D("irritated", {
			trust: 0.5,
			anxiety: 0.1,
			irritation: 0.95,
			cooperation: 0.6,
		});
		expect(cfg.browAngle).toBeLessThan(0);
		expect(cfg.mouth).toBe("frown");
	});

	it("high anxiety widens eyes", () => {
		const cfg = faceConfigFrom4D("neutral", { ...MID, anxiety: 0.9 });
		expect(cfg.eyeOpenness).toBeGreaterThanOrEqual(0.65);
	});

	it("low trust + low cooperation tightens mouth and narrows eyes", () => {
		const cfg = faceConfigFrom4D("neutral", { ...MID, trust: 0.1, cooperation: 0.1 });
		expect(cfg.mouth).toBe("tight");
		expect(cfg.eyeOpenness).toBeLessThanOrEqual(0.4);
	});

	it("withdrawn shows tears", () => {
		expect(faceConfigFrom4D("withdrawn", MID).tears).toBe(true);
	});

	it("open_trusting smiles", () => {
		const cfg = faceConfigFrom4D("open_trusting", MID);
		expect(cfg.mouth).toBe("smile");
		expect(cfg.browAngle).toBeGreaterThan(0);
	});

	it("unknown label falls back to neutral", () => {
		expect(faceConfigFrom4D("legacy_label" as never, MID)).toEqual(NEUTRAL_FACE);
	});

	it("does not mutate the neutral baseline", () => {
		faceConfigFrom4D("irritated", { ...MID, irritation: 1 });
		expect(NEUTRAL_FACE).toEqual({
			browAngle: 0,
			eyeOpenness: 0.55,
			eyeShape: "flat",
			mouth: "flat",
			blush: false,
			tears: false,
		});
	});
});
