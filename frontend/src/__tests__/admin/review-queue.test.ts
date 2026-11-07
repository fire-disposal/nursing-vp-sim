import { describe, expect, it } from "vitest";
import { nextPendingId } from "@/pages/admin/review-queue";

const pending = (id: number) => ({ id, score_reviewed: false });
const reviewed = (id: number) => ({ id, score_reviewed: true });

describe("nextPendingId", () => {
	it("returns the next unreviewed record after the current one", () => {
		expect(nextPendingId([pending(1), pending(2), pending(3)], 1)).toBe(2);
	});

	it("skips reviewed records and the current one", () => {
		expect(nextPendingId([pending(1), reviewed(2), reviewed(3), pending(4)], 1)).toBe(4);
	});

	it("wraps to the beginning and never returns the current record", () => {
		expect(nextPendingId([pending(1), pending(2)], 2)).toBe(1);
		expect(nextPendingId([pending(7)], 7)).toBeNull();
	});

	it("returns null when nothing is pending", () => {
		expect(nextPendingId([reviewed(1), reviewed(2)], 1)).toBeNull();
	});
});
