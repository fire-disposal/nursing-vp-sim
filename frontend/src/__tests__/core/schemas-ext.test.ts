import { describe, expect, it } from "vitest";
import { assignmentSchema } from "@/schemas/assignment";
import { gradeClassSchema } from "@/schemas/grade-class";
import { llmConfigSchema } from "@/schemas/llm-config";
import { notificationSchema } from "@/schemas/notification";
import { passwordChangeSchema, profileSchema } from "@/schemas/profile";
import { roleCreateSchema } from "@/schemas/role";
import { secretFormSchema } from "@/schemas/secret";
import { editUserSchema, registerUserSchema } from "@/schemas/user";

type FailedParse = {
	success: false;
	error: { issues: Array<{ path: unknown; message: string }> };
};

function errorMsg(result: FailedParse, path?: string): string {
	if (path) {
		const issue = result.error.issues.find((i) => {
			const joined = Array.isArray(i.path) ? i.path.join(".") : String(i.path);
			return joined === path;
		});
		return issue?.message ?? "";
	}
	return result.error.issues[0]?.message ?? "";
}

describe("assignmentSchema", () => {
	const valid = {
		title: "练习一",
		desc: "",
		caseId: 3,
		classId: 1,
		startTime: "2026-08-01T10:00",
		endTime: "2026-08-02T10:00",
		maxAttempts: null,
		hideCaseInfo: false,
	};

	it("accepts valid assignment", () => {
		expect(assignmentSchema.safeParse(valid).success).toBe(true);
	});

	it("rejects empty title", () => {
		const r = assignmentSchema.safeParse({ ...valid, title: "" });
		expect(r.success).toBe(false);
	});

	it("rejects missing case", () => {
		const r = assignmentSchema.safeParse({ ...valid, caseId: 0 });
		expect(r.success).toBe(false);
		if (!r.success) expect(errorMsg(r)).toContain("请选择病例");
	});

	it("rejects end before start", () => {
		const r = assignmentSchema.safeParse({
			...valid,
			startTime: "2026-08-02T10:00",
			endTime: "2026-08-01T10:00",
		});
		expect(r.success).toBe(false);
		if (!r.success) expect(errorMsg(r, "endTime")).toContain("晚于");
	});

	it("rejects equal start and end (strictly greater required)", () => {
		const r = assignmentSchema.safeParse({ ...valid, endTime: valid.startTime });
		expect(r.success).toBe(false);
	});

	it("rejects negative attempts", () => {
		const r = assignmentSchema.safeParse({ ...valid, maxAttempts: -1 });
		expect(r.success).toBe(false);
	});
});

describe("secretFormSchema", () => {
	const valid = { label: "主密钥", monthlyLimit: 100, priority: 1, modelOverride: null };

	it("accepts valid secret without optional fields", () => {
		expect(secretFormSchema.safeParse(valid).success).toBe(true);
	});

	it("rejects empty label", () => {
		expect(secretFormSchema.safeParse({ ...valid, label: "" }).success).toBe(false);
	});

	it("rejects malformed baseUrl", () => {
		const r = secretFormSchema.safeParse({ ...valid, baseUrl: "example.com" });
		expect(r.success).toBe(false);
	});

	it("accepts http and https urls", () => {
		expect(secretFormSchema.safeParse({ ...valid, baseUrl: "https://api.example.com" }).success).toBe(true);
		expect(secretFormSchema.safeParse({ ...valid, baseUrl: "http://api.example.com/v1" }).success).toBe(true);
	});

	it("rejects negative monthly limit", () => {
		expect(secretFormSchema.safeParse({ ...valid, monthlyLimit: -5 }).success).toBe(false);
	});

	it("rejects non-integer priority", () => {
		expect(secretFormSchema.safeParse({ ...valid, priority: 1.5 }).success).toBe(false);
	});
});

describe("profileSchema", () => {
	it("accepts valid profile", () => {
		expect(profileSchema.safeParse({ displayName: "王", gender: "女" }).success).toBe(true);
	});

	it("rejects empty display name", () => {
		expect(profileSchema.safeParse({ displayName: "", gender: "男" }).success).toBe(false);
	});

	it("accepts optional studentId", () => {
		expect(profileSchema.safeParse({ displayName: "王", studentId: "2026001", gender: "女" }).success).toBe(true);
	});
});

describe("passwordChangeSchema", () => {
	it("accepts password >= 6 chars", () => {
		expect(passwordChangeSchema.safeParse({ oldPassword: "old", newPassword: "newpass" }).success).toBe(true);
	});

	it("rejects short new password", () => {
		const r = passwordChangeSchema.safeParse({ oldPassword: "old", newPassword: "12345" });
		expect(r.success).toBe(false);
		if (!r.success) expect(errorMsg(r, "newPassword")).toContain("6");
	});

	it("rejects empty old password", () => {
		expect(passwordChangeSchema.safeParse({ oldPassword: "", newPassword: "newpass" }).success).toBe(false);
	});
});

describe("roleCreateSchema", () => {
	it("accepts valid role", () => {
		expect(roleCreateSchema.safeParse({ name: "nurse", displayName: "护士" }).success).toBe(true);
	});

	it("rejects empty name or display", () => {
		expect(roleCreateSchema.safeParse({ name: "", displayName: "x" }).success).toBe(false);
		expect(roleCreateSchema.safeParse({ name: "x", displayName: "" }).success).toBe(false);
	});
});

describe("registerUserSchema", () => {
	it("accepts valid user", () => {
		expect(
			registerUserSchema.safeParse({
				username: "student01",
				password: "secret1",
				role: "student",
				display_name: "小明",
			}).success,
		).toBe(true);
	});

	it("rejects illegal username chars", () => {
		const r = registerUserSchema.safeParse({
			username: "bad name!",
			password: "secret1",
			role: "student",
			display_name: "小明",
		});
		expect(r.success).toBe(false);
		if (!r.success) expect(errorMsg(r, "username")).toContain("只能包含");
	});

	it("rejects short password", () => {
		const r = registerUserSchema.safeParse({
			username: "ok1",
			password: "123",
			role: "student",
			display_name: "小明",
		});
		expect(r.success).toBe(false);
	});
});

describe("editUserSchema", () => {
	it("accepts minimal edit", () => {
		expect(editUserSchema.safeParse({ display_name: "小李", role: "student" }).success).toBe(true);
	});

	it("rejects empty name or role", () => {
		expect(editUserSchema.safeParse({ display_name: "", role: "student" }).success).toBe(false);
		expect(editUserSchema.safeParse({ display_name: "小李", role: "" }).success).toBe(false);
	});
});

describe("gradeClassSchema", () => {
	it("accepts valid grade/class", () => {
		expect(gradeClassSchema.safeParse({ name: "护理1班", gradeId: "g1" }).success).toBe(true);
	});

	it("rejects empty name", () => {
		expect(gradeClassSchema.safeParse({ name: "", gradeId: "g1" }).success).toBe(false);
	});
});

describe("llmConfigSchema", () => {
	it("accepts valid config", () => {
		expect(llmConfigSchema.safeParse({ secretId: "s1", label: "主", purpose: "patient_chat" }).success).toBe(true);
	});

	it("rejects missing secret or purpose", () => {
		expect(llmConfigSchema.safeParse({ secretId: "", label: "", purpose: "x" }).success).toBe(false);
		expect(llmConfigSchema.safeParse({ secretId: "s1", label: "", purpose: "" }).success).toBe(false);
	});
});

describe("notificationSchema", () => {
	it("accepts valid notification", () => {
		expect(notificationSchema.safeParse({ title: "通知", content: "内容", level: "info" }).success).toBe(true);
	});

	it("rejects empty title or content", () => {
		expect(notificationSchema.safeParse({ title: "", content: "c", level: "info" }).success).toBe(false);
		expect(notificationSchema.safeParse({ title: "t", content: "", level: "info" }).success).toBe(false);
	});

	it("rejects unknown level", () => {
		expect(notificationSchema.safeParse({ title: "t", content: "c", level: "urgent" }).success).toBe(false);
	});
});
