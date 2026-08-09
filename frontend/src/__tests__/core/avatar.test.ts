import { describe, expect, it, vi } from "vitest";

vi.mock("@/assets/avatars/simple/nurse_female.png", () => ({
	default: "nurse_female",
}));
vi.mock("@/assets/avatars/simple/nurse_male.png", () => ({ default: "nurse_male" }));
vi.mock("@/assets/avatars/simple/patient_child_female.png", () => ({
	default: "patient_child_female",
}));
vi.mock("@/assets/avatars/simple/patient_child_male.png", () => ({
	default: "patient_child_male",
}));
vi.mock("@/assets/avatars/simple/patient_elder_female.png", () => ({
	default: "patient_elder_female",
}));
vi.mock("@/assets/avatars/simple/patient_elder_male.png", () => ({
	default: "patient_elder_male",
}));
vi.mock("@/assets/avatars/simple/patient_middle_female.png", () => ({
	default: "patient_middle_female",
}));
vi.mock("@/assets/avatars/simple/patient_middle_male.png", () => ({
	default: "patient_middle_male",
}));
vi.mock("@/assets/avatars/simple/patient_youth_female.png", () => ({
	default: "patient_youth_female",
}));
vi.mock("@/assets/avatars/simple/patient_youth_male.png", () => ({
	default: "patient_youth_male",
}));

import type { PatientInfo } from "@/utils/avatar";
import { getAgeGroup, getNurseAvatar, getPatientAvatar } from "@/utils/avatar";

describe("getAgeGroup", () => {
	it('returns "child" for age ≤ 12', () => {
		expect(getAgeGroup(5)).toBe("child");
		expect(getAgeGroup(12)).toBe("child");
	});

	it('returns "youth" for age 13-25', () => {
		expect(getAgeGroup(13)).toBe("youth");
		expect(getAgeGroup(25)).toBe("youth");
	});

	it('returns "middle" for age 26-59', () => {
		expect(getAgeGroup(26)).toBe("middle");
		expect(getAgeGroup(59)).toBe("middle");
	});

	it('returns "elder" for age >= 60', () => {
		expect(getAgeGroup(60)).toBe("elder");
		expect(getAgeGroup(80)).toBe("elder");
	});

	it('returns "middle" for null/undefined/zero age', () => {
		expect(getAgeGroup(null)).toBe("middle");
		expect(getAgeGroup(undefined)).toBe("middle");
		expect(getAgeGroup(0)).toBe("middle");
	});
});

describe("getPatientAvatar", () => {
	it("returns default for null/undefined patientInfo", () => {
		const result = getPatientAvatar(null);
		expect(result).toBe("patient_middle_male");
		expect(getPatientAvatar(undefined)).toBe("patient_middle_male");
	});

	it("returns correct avatar for child female with age 10", () => {
		const patient: PatientInfo = { age: 10, gender: "女" };
		expect(getPatientAvatar(patient)).toBe("patient_child_female");
	});

	it("returns correct avatar for middle male with age 40", () => {
		const patient: PatientInfo = { age: 40, gender: "男" };
		expect(getPatientAvatar(patient)).toBe("patient_middle_male");
	});

	it("returns correct avatar for elder female with age 65", () => {
		const patient: PatientInfo = { age: 65, gender: "女" };
		expect(getPatientAvatar(patient)).toBe("patient_elder_female");
	});

	it("defaults to male when gender is unknown", () => {
		const patient: PatientInfo = { age: 25, gender: "未知" };
		expect(getPatientAvatar(patient)).toBe("patient_youth_male");
	});

	it("returns realistic avatar for bound patient once png present", () => {
		// 王建国已绑定写实头像，realistic/ 下存在 PNG 时应返回写实资源而非默认头像。
		const patient: PatientInfo = { name: "王建国", age: 68, gender: "男" };
		const result = getPatientAvatar(patient);
		expect(result).toContain("avatars/realistic/case-chest-pain-elder-male.png");
		expect(result).not.toBe("patient_elder_male");
	});

	it("returns realistic avatar for 张美华 (fever female binding)", () => {
		const patient: PatientInfo = { name: "张美华", age: 55, gender: "女" };
		const result = getPatientAvatar(patient);
		expect(result).toContain("avatars/realistic/case-fever-middle-female.png");
		expect(result).not.toBe("patient_middle_female");
	});

	it("uses default avatar for patient without a bound realistic image", () => {
		const patient: PatientInfo = { name: "李明", age: 27, gender: "男" };
		expect(getPatientAvatar(patient)).toBe("patient_middle_male");
	});
});

describe("getNurseAvatar", () => {
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
});
