import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/utils/login-redirect";

describe("safeNextPath", () => {
	it("保留站内深链接的 query 与 hash", () => {
		expect(safeNextPath("/admin/records/12?review_status=pending#evidence")).toBe(
			"/admin/records/12?review_status=pending#evidence",
		);
	});

	it.each([null, undefined, "", "admin", "https://evil.example", "//evil.example", "/\\evil.example"])(
		"拒绝非站内或协议相对地址：%s",
		(raw) => {
			expect(safeNextPath(raw)).toBe("/home");
		},
	);

	it("不把登录页自身作为回跳目标", () => {
		expect(safeNextPath("/login?next=/admin")).toBe("/home");
	});
});
