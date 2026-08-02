import { describe, expect, it } from "vitest";
import { ageGroupFor, appearanceFor, appearanceForPatient, mixHex } from "./appearance";

const COMBOS = [
	"female-child",
	"female-young",
	"female-middle",
	"female-elderly",
	"male-child",
	"male-young",
	"male-middle",
	"male-elderly",
] as const;

describe("ageGroupFor", () => {
	it("maps the 4-stage thresholds (aligned to TTS mapper)", () => {
		expect(ageGroupFor(0)).toBe("child");
		expect(ageGroupFor(12)).toBe("child");
		expect(ageGroupFor(13)).toBe("young");
		expect(ageGroupFor(25)).toBe("young");
		expect(ageGroupFor(26)).toBe("middle");
		expect(ageGroupFor(59)).toBe("middle");
		expect(ageGroupFor(60)).toBe("elderly");
		expect(ageGroupFor(95)).toBe("elderly");
	});
});

describe("appearanceFor", () => {
	it("covers all 6 gender×age combos deterministically", () => {
		for (const combo of COMBOS) {
			const [g, a] = combo.split("-") as ["female" | "male", "young" | "middle" | "elderly"];
			expect(appearanceFor(g, a)).toEqual(appearanceFor(g, a));
		}
	});

	it("hair grays increase with age", () => {
		const f = appearanceFor("female", "young").hairGrays;
		const m = appearanceFor("female", "middle").hairGrays;
		const e = appearanceFor("female", "elderly").hairGrays;
		expect(f).toBeLessThan(m);
		expect(m).toBeLessThan(e);
	});

	it("hair style differentiates gender and age", () => {
		expect(appearanceFor("female", "child").hairStyle).toBe("pigtails");
		expect(appearanceFor("female", "young").hairStyle).toBe("long");
		expect(appearanceFor("female", "middle").hairStyle).toBe("longSide");
		expect(appearanceFor("female", "elderly").hairStyle).toBe("bun");
		expect(appearanceFor("male", "elderly").hairStyle).toBe("receding");
		expect(appearanceFor("male", "young").hairStyle).toBe("short");
	});

	it("male brow is heavier and no lashes", () => {
		expect(appearanceFor("male", "middle").browWeight).toBeGreaterThan(1);
		expect(appearanceFor("male", "middle").lashes).toBe(false);
		expect(appearanceFor("female", "young").lashes).toBe(true);
	});

	it("wrinkles and skin muting increase with age", () => {
		const young = appearanceFor("male", "young");
		const elderly = appearanceFor("male", "elderly");
		expect(elderly.wrinkles).toBeGreaterThan(young.wrinkles);
		expect(elderly.skinMuted).toBeGreaterThan(young.skinMuted);
	});
});

describe("appearanceForPatient", () => {
	it("resolves appearance from patient age and gender", () => {
		expect(appearanceForPatient(8, "female")).toEqual(appearanceFor("female", "child"));
		expect(appearanceForPatient(30, "male")).toEqual(appearanceFor("male", "middle"));
		expect(appearanceForPatient(70, "female")).toEqual(appearanceFor("female", "elderly"));
	});

	it("falls back to young for unknown or anonymized age (never child)", () => {
		expect(appearanceForPatient(0, "male")).toEqual(appearanceFor("male", "young"));
		expect(appearanceForPatient(null, "female")).toEqual(appearanceFor("female", "young"));
		expect(appearanceForPatient(undefined, undefined)).toEqual(appearanceFor("female", "young"));
	});

	it("unknown gender defaults to female", () => {
		expect(appearanceForPatient(45, "")).toEqual(appearanceFor("female", "middle"));
	});
});

describe("mixHex", () => {
	it("mixes colors linearly", () => {
		expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
		expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
		expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
	});

	it("expects 6-digit hex inputs", () => {
		expect(mixHex("#ff0000", "#0000ff", 0.5)).toBe("#800080");
		expect(mixHex("#f8d6b4", "#dcc9b2", 1)).toBe("#dcc9b2");
	});
});
