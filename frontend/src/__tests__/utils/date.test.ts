import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, fromDatetimeLocal, toDatetimeLocal } from "@/utils/date";

describe("formatDate", () => {
	it("formats Date object", () => {
		expect(formatDate(new Date(2026, 5, 25))).toBe("2026/6/25");
	});
	it("formats ISO string", () => {
		expect(formatDate("2026-06-25T10:30:00")).toMatch(/2026\/6\/25/);
	});
	it("returns empty for null/undefined/empty", () => {
		expect(formatDate(null)).toBe("");
		expect(formatDate(undefined)).toBe("");
		expect(formatDate("")).toBe("");
	});
	it("returns empty for invalid date", () => {
		expect(formatDate("not-a-date")).toBe("");
		expect(formatDate(Number.NaN)).toBe("");
	});
});

describe("formatDateTime", () => {
	it("formats date and time", () => {
		const s = formatDateTime(new Date(2026, 5, 25, 14, 30, 0));
		expect(s).toContain("2026/6/25");
		expect(s).toContain("14:30");
	});
	it("returns empty for invalid input", () => {
		expect(formatDateTime(null)).toBe("");
		expect(formatDateTime("garbage")).toBe("");
	});
});

describe("toDatetimeLocal", () => {
	it("produces datetime-local value without seconds", () => {
		const d = new Date(2026, 0, 5, 9, 7, 59);
		expect(toDatetimeLocal(d)).toBe("2026-01-05T09:07");
	});
	it("pads month/day/hour/minute", () => {
		expect(toDatetimeLocal(new Date(2026, 11, 31, 23, 5, 0))).toBe("2026-12-31T23:05");
	});
	it("returns empty for invalid input", () => {
		expect(toDatetimeLocal(null)).toBe("");
	});
});

describe("fromDatetimeLocal", () => {
	it("parses to ISO string", () => {
		const iso = fromDatetimeLocal("2026-06-25T10:30");
		expect(iso).not.toBeNull();
		expect(new Date(iso!).toISOString()).toBe(iso);
	});
	it("returns null for empty input", () => {
		expect(fromDatetimeLocal(null)).toBeNull();
		expect(fromDatetimeLocal("")).toBeNull();
		expect(fromDatetimeLocal(undefined)).toBeNull();
	});
	it("returns null for invalid input", () => {
		expect(fromDatetimeLocal("junk")).toBeNull();
	});
});
