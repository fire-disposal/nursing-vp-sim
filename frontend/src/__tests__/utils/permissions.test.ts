import { describe, expect, it } from "vitest";
import { isAdminPermissions, PERMISSION_KEYS, STUDENT_TIER_PERMISSIONS } from "@/utils/permissions";

describe("STUDENT_TIER_PERMISSIONS", () => {
	it("contains only student-tier keys", () => {
		for (const p of STUDENT_TIER_PERMISSIONS) {
			expect(PERMISSION_KEYS).toContain(p);
		}
	});

	it("学生层权限不该被当成管理员", () => {
		expect(STUDENT_TIER_PERMISSIONS.has("training_access")).toBe(true);
		expect(isAdminPermissions(["training_access"])).toBe(false);
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
