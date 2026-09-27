import { describe, expect, it } from "vitest";
import { isAdminPermissions, PERMISSION_KEYS, STUDENT_TIER_PERMISSIONS } from "@/utils/permissions";

describe("STUDENT_TIER_PERMISSIONS", () => {
	it("contains only student-tier keys", () => {
		for (const p of STUDENT_TIER_PERMISSIONS) {
			expect(PERMISSION_KEYS).toContain(p);
		}
	});

	it("情境训练算学生层：只有它的学生不该被当成管理员", () => {
		expect(STUDENT_TIER_PERMISSIONS.has("scenario_training")).toBe(true);
		expect(isAdminPermissions(["scenario_training"])).toBe(false);
		expect(isAdminPermissions(["training_access", "qa_access", "scenario_training"])).toBe(false);
	});
});

describe("isAdminPermissions", () => {
	it("true when any non-student permission present", () => {
		expect(isAdminPermissions(["training_access", "user_manage"])).toBe(true);
		expect(isAdminPermissions(["qa_access", "case_manage"])).toBe(true);
	});

	it("false when only student-tier permissions", () => {
		expect(isAdminPermissions(["training_access", "qa_access", "stats_view"])).toBe(false);
	});

	it("false for empty list", () => {
		expect(isAdminPermissions([])).toBe(false);
	});
});
