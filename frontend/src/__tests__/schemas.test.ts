import { describe, expect, it } from "vitest";
import { changePasswordSchema, loginSchema } from "@/schemas/auth";

describe("loginSchema", () => {
	it("validates with valid data (username and password non-empty)", () => {
		const result = loginSchema.safeParse({
			username: "testuser",
			password: "secret",
		});
		expect(result.success).toBe(true);
	});

	it("fails when username is empty", () => {
		const result = loginSchema.safeParse({ username: "", password: "secret" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toContainEqual(
				expect.objectContaining({ path: ["username"] }),
			);
		}
	});

	it("fails when username exceeds 50 chars", () => {
		const result = loginSchema.safeParse({
			username: "a".repeat(51),
			password: "secret",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toContainEqual(
				expect.objectContaining({ path: ["username"] }),
			);
		}
	});

	it("fails when password is empty", () => {
		const result = loginSchema.safeParse({
			username: "testuser",
			password: "",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toContainEqual(
				expect.objectContaining({ path: ["password"] }),
			);
		}
	});
});

describe("changePasswordSchema", () => {
	it("validates with matching passwords >= 6 chars", () => {
		const result = changePasswordSchema.safeParse({
			oldPassword: "oldpass",
			newPassword: "newpass",
			confirmPassword: "newpass",
		});
		expect(result.success).toBe(true);
	});

	it("fails when oldPassword is empty", () => {
		const result = changePasswordSchema.safeParse({
			oldPassword: "",
			newPassword: "newpass",
			confirmPassword: "newpass",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toContainEqual(
				expect.objectContaining({ path: ["oldPassword"] }),
			);
		}
	});

	it("fails when newPassword < 6 chars", () => {
		const result = changePasswordSchema.safeParse({
			oldPassword: "oldpass",
			newPassword: "short",
			confirmPassword: "short",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toContainEqual(
				expect.objectContaining({ path: ["newPassword"] }),
			);
		}
	});

	it("fails when newPassword > 128 chars", () => {
		const long = "a".repeat(129);
		const result = changePasswordSchema.safeParse({
			oldPassword: "oldpass",
			newPassword: long,
			confirmPassword: long,
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toContainEqual(
				expect.objectContaining({ path: ["newPassword"] }),
			);
		}
	});

	it("fails when confirmPassword doesn't match newPassword", () => {
		const result = changePasswordSchema.safeParse({
			oldPassword: "oldpass",
			newPassword: "newpass",
			confirmPassword: "different",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toContainEqual(
				expect.objectContaining({ path: ["confirmPassword"] }),
			);
		}
	});
});
