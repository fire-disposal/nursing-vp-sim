import { describe, expect, it } from "vitest";
import {
	EASINGS,
	interpolateExtras,
	interpolateFaceConfig,
} from "./animation";
import { NEUTRAL_FACE, type FaceConfig } from "@/components/training/face/expressionMap";
import { NEUTRAL_EXTRAS, type PremiumExtras } from "@/components/training/face/premiumExtras";

const TENSE: FaceConfig = {
	browAngle: -0.8,
	eyeOpenness: 0.35,
	eyeShape: "narrow",
	mouth: "frown",
	blush: false,
	tears: false,
};

const TENSE_EXTRAS: PremiumExtras = {
	headTilt: -2.5,
	sweat: false,
	furrow: true,
	irisShift: "away",
	eyeLid: 0.55,
};

describe("EASINGS", () => {
	it("all easings pass through endpoints", () => {
		for (const fn of Object.values(EASINGS)) {
			expect(fn(0)).toBeCloseTo(0);
			expect(fn(1)).toBeCloseTo(1);
		}
	});

	it("easeOut starts fast and settles", () => {
		expect(EASINGS.easeOut(0.25)).toBeGreaterThan(0.25);
		expect(EASINGS.easeOut(0.75)).toBeGreaterThan(0.75);
	});

	it("back easing overshoots beyond 1", () => {
		expect(EASINGS.back(0.6)).toBeGreaterThan(1);
	});
});

describe("interpolateFaceConfig", () => {
	it("t=0 yields source, t=1 yields target", () => {
		expect(interpolateFaceConfig(NEUTRAL_FACE, TENSE, 0)).toEqual(NEUTRAL_FACE);
		expect(interpolateFaceConfig(NEUTRAL_FACE, TENSE, 1)).toEqual(TENSE);
	});

	it("numeric fields interpolate at midpoint", () => {
		const mid = interpolateFaceConfig(NEUTRAL_FACE, TENSE, 0.5);
		expect(mid.browAngle).toBeCloseTo(-0.4);
		expect(mid.eyeOpenness).toBeCloseTo(0.45);
	});

	it("discrete fields switch at the midpoint", () => {
		expect(interpolateFaceConfig(NEUTRAL_FACE, TENSE, 0.49).mouth).toBe("flat");
		expect(interpolateFaceConfig(NEUTRAL_FACE, TENSE, 0.5).mouth).toBe("frown");
		expect(interpolateFaceConfig(NEUTRAL_FACE, TENSE, 0.49).eyeShape).toBe("flat");
		expect(interpolateFaceConfig(NEUTRAL_FACE, TENSE, 0.5).eyeShape).toBe("narrow");
	});
});

describe("interpolateExtras", () => {
	it("interpolates numeric fields and switches discrete ones", () => {
		const mid = interpolateExtras(NEUTRAL_EXTRAS, TENSE_EXTRAS, 0.5);
		expect(mid.headTilt).toBeCloseTo(-1.25);
		expect(mid.eyeLid).toBeCloseTo(0.275);
		expect(mid.furrow).toBe(true);
		expect(mid.sweat).toBe(false);
		expect(mid.irisShift).toBe("away");
	});

	it("endpoints match source and target", () => {
		expect(interpolateExtras(NEUTRAL_EXTRAS, TENSE_EXTRAS, 0)).toEqual(NEUTRAL_EXTRAS);
		expect(interpolateExtras(NEUTRAL_EXTRAS, TENSE_EXTRAS, 1)).toEqual(TENSE_EXTRAS);
	});
});
