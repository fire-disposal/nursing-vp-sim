import { describe, expect, it } from "vitest";
import { avatarFor } from "@/scenario/avatar";

describe("头像派生（前端从 avatar_seed 换算，后端不给头像图片）", () => {
	it("同一 seed 恒定得到同一颜色与同一首字", () => {
		const first = avatarFor("patient");
		expect(avatarFor("patient")).toEqual(first);
		expect(first.color).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
		expect(first.initials).toBe("PA");
	});

	it("中文名取首字，MD 写的临时角色名同样可用", () => {
		expect(avatarFor("患者·张伯").initials).toBe("患");
		expect(avatarFor("走廊里的护工").initials).toBe("走");
		expect(avatarFor("广播（3 楼）").initials).toBe("广");
	});

	it("不同 seed 取色不同（不是固定色）", () => {
		const colors = [
			"patient",
			"doctor",
			"nurse_aide",
			"走廊里的护工",
			"广播（3 楼）",
		].map((seed) => avatarFor(seed).color);
		expect(new Set(colors).size).toBe(colors.length);
	});

	it("颜色随 seed，首字随显示名（声明角色的 id 是英文 slug，不能拿它当字）", () => {
		const bySeed = avatarFor("patient", "A 床患者");
		expect(bySeed.initials).toBe("A");
		// 同一个 seed 换显示名：颜色不变
		expect(avatarFor("patient", "换个叫法").color).toBe(bySeed.color);
		// 不同 seed 相同显示名：颜色不同、首字相同
		expect(avatarFor("patient_b", "A 床患者").color).not.toBe(bySeed.color);
		expect(avatarFor("patient_b", "A 床患者").initials).toBe("A");
	});

	it("空 seed 也有兜底（不崩、不留空头像）", () => {
		expect(avatarFor("   ")).toEqual({ color: "hsl(200 12% 55%)", initials: "人" });
	});
});
