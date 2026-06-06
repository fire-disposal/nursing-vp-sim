import { describe, expect, it, vi } from "vitest";

vi.mock("../assets/avatars/nurse_female.png", () => ({ default: "nurse_female" }));
vi.mock("../assets/avatars/nurse_male.png", () => ({ default: "nurse_male" }));
vi.mock("../assets/avatars/patient_child_female.png", () => ({ default: "patient_child_female" }));
vi.mock("../assets/avatars/patient_child_male.png", () => ({ default: "patient_child_male" }));
vi.mock("../assets/avatars/patient_elder_female.png", () => ({ default: "patient_elder_female" }));
vi.mock("../assets/avatars/patient_elder_male.png", () => ({ default: "patient_elder_male" }));
vi.mock("../assets/avatars/patient_middle_female.png", () => ({ default: "patient_middle_female" }));
vi.mock("../assets/avatars/patient_middle_male.png", () => ({ default: "patient_middle_male" }));
vi.mock("../assets/avatars/patient_youth_female.png", () => ({ default: "patient_youth_female" }));
vi.mock("../assets/avatars/patient_youth_male.png", () => ({ default: "patient_youth_male" }));

import type { PatientInfo } from "@/utils/avatar";
import { getAgeGroup, getNurseAvatar, getPatientAvatar } from "@/utils/avatar";

describe("getAgeGroup", () => {
  it('returns "child" for age < 15', () => {
    expect(getAgeGroup(5)).toBe("child");
    expect(getAgeGroup(14)).toBe("child");
  });

  it('returns "youth" for age 15-35', () => {
    expect(getAgeGroup(20)).toBe("youth");
    expect(getAgeGroup(35)).toBe("youth");
  });

  it('returns "middle" for age 36-59', () => {
    expect(getAgeGroup(40)).toBe("middle");
    expect(getAgeGroup(59)).toBe("middle");
  });

  it('returns "elder" for age >= 60', () => {
    expect(getAgeGroup(60)).toBe("elder");
    expect(getAgeGroup(80)).toBe("elder");
  });

  it('returns "youth" for null/undefined age', () => {
    expect(getAgeGroup(null)).toBe("youth");
    expect(getAgeGroup(undefined)).toBe("youth");
  });
});

describe("getPatientAvatar", () => {
  it("returns default for null/undefined patientInfo", () => {
    const result = getPatientAvatar(null);
    expect(result).toBe("patient_youth_male");
    expect(getPatientAvatar(undefined)).toBe("patient_youth_male");
  });

  it("returns correct avatar for child female with age < 15", () => {
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
