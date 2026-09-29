/**
 * 兜底页的"缓存类故障"提示（docs/onboarding.md 常见问题）。
 *
 * 这里钉住的是**契约**：真实见过的那两类报错，必须能给出可执行的下一步；其它错误不能乱给建议。
 */
import { describe, expect, it } from "vitest";
import { CACHE_HINTS } from "@/components/ErrorBoundary";

const hintFor = (message: string) => CACHE_HINTS.find((h) => h.pattern.test(message))?.hint;

describe("缓存类故障提示", () => {
	it("实测过的 Mantine 双实例报错 → 给出清理命令", () => {
		const hint = hintFor("@mantine/core: MantineProvider was not found in component tree, make sure you have it in your app");
		expect(hint).toContain("pnpm run dev:clean");
	});

	it("模块图过期类报错 → 先刷新再清理", () => {
		expect(hintFor("Failed to fetch dynamically imported module: /src/pages/admin/TeacherRecordsPage.tsx")).toContain("刷新");
		expect(hintFor("Outdated Optimize Dep")).toContain("dev:clean");
	});

	it("无关错误不给缓存建议（避免误导排查方向）", () => {
		expect(hintFor("Cannot read properties of undefined (reading 'items')")).toBeUndefined();
		expect(hintFor("")).toBeUndefined();
	});
});
