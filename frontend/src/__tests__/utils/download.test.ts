import { describe, expect, it } from "vitest";
import { filenameFromDisposition } from "@/api/download";

describe("filenameFromDisposition", () => {
	it("parses RFC 5987 UTF-8 filenames (the format our exporter emits)", () => {
		const header = "attachment; filename*=UTF-8''%E6%88%90%E6%9C%AC%E6%98%8E%E7%BB%86.csv";
		expect(filenameFromDisposition(header)).toBe("成本明细.csv");
	});

	it("parses plain quoted filenames", () => {
		expect(filenameFromDisposition('attachment; filename="report.csv"')).toBe("report.csv");
	});

	it("returns null when the header is missing or malformed", () => {
		expect(filenameFromDisposition(undefined)).toBeNull();
		expect(filenameFromDisposition("attachment")).toBeNull();
	});
});
