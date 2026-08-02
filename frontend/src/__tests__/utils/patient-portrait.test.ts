import { describe, expect, it } from "vitest";
import { getPatientPortraitUrl } from "@/utils/patient-portrait";

describe("getPatientPortraitUrl", () => {
	it("falls back to base avatar without emotion", () => {
		expect(getPatientPortraitUrl({ gender: "女", age: 40 })).toMatch(/\.png$/);
	});

	it("falls back to base avatar for unknown emotion", () => {
		expect(getPatientPortraitUrl({ gender: "男", age: 30 }, "furious")).toMatch(/\.png$/);
	});

	it("maps neutral to base avatar", () => {
		const base = getPatientPortraitUrl({ gender: "男", age: 30 });
		expect(getPatientPortraitUrl({ gender: "男", age: 30 }, "neutral")).toBe(base);
	});

	it("returns variant for known emotion", () => {
		const url = getPatientPortraitUrl({ gender: "女", age: 70 }, "withdrawn");
		expect(url).toMatch(/patient_elder_female-s\.png/);
	});

	it("relaxed and open share the happy variant", () => {
		const relaxed = getPatientPortraitUrl({ gender: "男", age: 8 }, "relaxed");
		const open = getPatientPortraitUrl({ gender: "男", age: 8 }, "open");
		expect(relaxed).toBe(open);
		expect(relaxed).toMatch(/-h\.png$/);
	});

	it("handles missing patient info", () => {
		expect(getPatientPortraitUrl(null, "anxious")).toMatch(/\.png$/);
		expect(getPatientPortraitUrl(undefined, "neutral")).toMatch(/\.png$/);
	});
});
