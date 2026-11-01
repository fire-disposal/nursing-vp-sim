import { describe, expect, it, vi } from "vitest";

vi.mock("@/assets/avatars/simple/nurse_female.png", () => ({ default: "nurse_female" }));
vi.mock("@/assets/avatars/simple/nurse_male.png", () => ({ default: "nurse_male" }));

import { getNurseAvatar, getRealisticPatientAvatar, getUserAvatar } from "@/utils/avatar";

describe("病例照片路由", () => {
	it("已绑定的论文病例 → 写实 PNG", () => {
		expect(getRealisticPatientAvatar("王建国")).toContain("case-chest-pain-elder-male");
		expect(getRealisticPatientAvatar("张美华")).toContain("case-fever-middle-female");
	});

	it("未绑定姓名 → null（无照片病例交给程序化绘制）", () => {
		expect(getRealisticPatientAvatar("李明")).toBeNull();
		expect(getRealisticPatientAvatar(null)).toBeNull();
		expect(getRealisticPatientAvatar(undefined)).toBeNull();
	});
});

describe("员工头像", () => {
	it('returns female avatar when gender is "女"', () => {
		expect(getNurseAvatar("女")).toBe("nurse_female");
	});

	it("returns female avatar for undefined/unknown gender", () => {
		expect(getNurseAvatar(undefined)).toBe("nurse_female");
		expect(getNurseAvatar("未知")).toBe("nurse_female");
	});

	it('returns male avatar when gender is "男"', () => {
		expect(getNurseAvatar("男")).toBe("nurse_male");
	});

	it("账号头像与护士头像同一份实现", () => {
		expect(getUserAvatar("male")).toBe(getNurseAvatar("male"));
	});
});
