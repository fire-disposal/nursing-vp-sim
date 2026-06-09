import nurseFemale from "../assets/avatars/nurse_female.png";
import nurseMale from "../assets/avatars/nurse_male.png";
import childFemale from "../assets/avatars/patient_child_female.png";
import childMale from "../assets/avatars/patient_child_male.png";
import elderFemale from "../assets/avatars/patient_elder_female.png";
import elderMale from "../assets/avatars/patient_elder_male.png";
import middleFemale from "../assets/avatars/patient_middle_female.png";
import middleMale from "../assets/avatars/patient_middle_male.png";
import youthFemale from "../assets/avatars/patient_youth_female.png";
import youthMale from "../assets/avatars/patient_youth_male.png";

const avatars: Record<string, string> = {
  patient_child_male: childMale,
  patient_child_female: childFemale,
  patient_youth_male: youthMale,
  patient_youth_female: youthFemale,
  patient_middle_male: middleMale,
  patient_middle_female: middleFemale,
  patient_elder_male: elderMale,
  patient_elder_female: elderFemale,
  nurse_male: nurseMale,
  nurse_female: nurseFemale,
};

export interface PatientInfo {
  name?: string | null;
  gender?: string | null;
  age?: number | null;
}

export function getAgeGroup(age: number | null | undefined): string {
  if (age == null) return "youth";
  if (age < 15) return "child";
  if (age < 36) return "youth";
  if (age < 60) return "middle";
  return "elder";
}

export function getPatientAvatar(patientInfo?: PatientInfo | null): string {
  if (!patientInfo) return avatars.patient_youth_male;

  const group = getAgeGroup(patientInfo.age);
  const sex = patientInfo.gender === "女" ? "female" : "male";
  const key = `patient_${group}_${sex}`;
  return avatars[key] || avatars.patient_youth_male;
}

export function getNurseAvatar(gender?: string | null): string {
  const sex = gender === "男" ? "male" : "female";
  return avatars[`nurse_${sex}`] || avatars.nurse_female;
}

export function getUserAvatar(gender?: string | null): string {
  return getNurseAvatar(gender);
}
