import { describe, expect, it } from "vitest";
import { resolveLandingPath } from "@/components/shell/navigation";

/**
 * 落地页契约：`/home` 必须把每个视角送到**它真的进得去**的第一页。
 *
 * 平台/运维视角没有 `stats_view`，旧口径按"有非学生权限就跳 /admin"会直接撞 403；
 * 这组用例钉住"永远有落点、不循环、不走 403"。
 */
const PLATFORM = ["school_manage", "api_manage", "audit_view", "audit_export", "llm_monitor", "export_data"];
const OPS = ["llm_monitor", "api_manage", "audit_view", "audit_export", "feedback_review", "export_data"];
const TEACHER = [
	"grade_class_manage",
	"case_manage",
	"score_review",
	"stats_view",
	"assignment_manage",
	"feedback_review",
	"export_data",
	"questionnaire_manage",
];
const STUDENT = ["training_access", "qa_access"];

describe("resolveLandingPath", () => {
	it("平台视角：没有 stats_view → 院校管理", () => {
		expect(resolveLandingPath(PLATFORM, "platform")).toBe("/admin/schools");
	});

	it("运维视角：没有 stats_view → 运维仪表盘", () => {
		expect(resolveLandingPath(OPS, "ops")).toBe("/admin/system-ops");
	});

	it("教师/院校管理员：教学看板", () => {
		expect(resolveLandingPath(TEACHER, "teacher")).toBe("/admin");
	});

	it("学生：训练", () => {
		expect(resolveLandingPath(STUDENT, "student")).toBe("/training");
	});

	it("只有问答权限：落到问答，而不是无权限的记录页", () => {
		expect(resolveLandingPath(["qa_access"], "student")).toBe("/qa");
	});

	it("没有任何导航权限：个人中心（永远可达，不制造 403 循环）", () => {
		expect(resolveLandingPath([], "student")).toBe("/profile");
	});
});
