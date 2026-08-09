import nurseFemale from "../assets/avatars/simple/nurse_female.png";
import nurseMale from "../assets/avatars/simple/nurse_male.png";
import childFemale from "../assets/avatars/simple/patient_child_female.png";
import childMale from "../assets/avatars/simple/patient_child_male.png";
import elderFemale from "../assets/avatars/simple/patient_elder_female.png";
import elderMale from "../assets/avatars/simple/patient_elder_male.png";
import middleFemale from "../assets/avatars/simple/patient_middle_female.png";
import middleMale from "../assets/avatars/simple/patient_middle_male.png";
import youthFemale from "../assets/avatars/simple/patient_youth_female.png";
import youthMale from "../assets/avatars/simple/patient_youth_male.png";

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

/**
 * 论文展示病例专属写实头像：按患者姓名精确绑定（欢迎页/聊天区/结果页三处都能命中）。
 * 图片放在 realistic/ 目录，用 import.meta.glob 动态加载：
 *   - 图片尚未放入时 glob 为空，自动回退到按年龄/性别默认头像，构建不受影响；
 *   - PNG 一旦放入即被自动加载，无需改动代码。
 * 资源命名遵循 docs/realistic-patient-avatar-plan.md §4.2。
 */
const realisticAvatarModules = import.meta.glob<{ default: string }>(
	"../assets/avatars/realistic/*.png",
	{ eager: true },
);

const realisticAvatarsByName: Record<string, string> = {
	"王建国": "case-chest-pain-elder-male.png",
	"张美华": "case-fever-middle-female.png",
};

export interface PatientInfo {
	name?: string | null;
	gender?: string | null;
	age?: number | null;
}

function isFemale(gender: string | null | undefined): boolean {
	return gender === "女" || gender === "female";
}

function isMale(gender: string | null | undefined): boolean {
	return gender === "男" || gender === "male";
}

export function displayGender(gender?: string | null): string {
	if (isMale(gender)) return "男";
	if (isFemale(gender)) return "女";
	return "未知";
}

export function getAgeGroup(age: number | null | undefined): string {
	if (age == null || age <= 0) return "middle";
	if (age <= 12) return "child";
	if (age <= 25) return "youth";
	if (age < 60) return "middle";
	return "elder";
}

export function getPatientKey(patientInfo?: PatientInfo | null): string {
	if (!patientInfo) return "patient_middle_male";
	const group = getAgeGroup(patientInfo.age);
	const sex = isFemale(patientInfo.gender) ? "female" : "male";
	return `patient_${group}_${sex}`;
}


export function safeAvatarUrl(
	url: string | null | undefined,
	fallback = avatars.patient_middle_male,
): string {
	if (!url || /^\s*file:/i.test(url)) return fallback;
	return url;
}
/** 简洁画风路由器：按年龄/性别取默认头像（恒适用，作为策略链兜底）。 */
export function getBasePatientAvatar(patientInfo?: PatientInfo | null): string {
	const key = getPatientKey(patientInfo);
	return avatars[key] || avatars.patient_middle_male;
}

/** 写实画风路由器：按患者姓名取论文专属写实头像；未绑定或文件缺失返回 null（让位给简洁路由）。 */
export function getRealisticPatientAvatar(name?: string | null): string | null {
	if (!name) return null;
	const filename = realisticAvatarsByName[name];
	if (!filename) return null;
	const mod = realisticAvatarModules[`../assets/avatars/realistic/${filename}`];
	return mod ? mod.default : null;
}

export function getPatientAvatar(patientInfo?: PatientInfo | null): string {
	return getRealisticPatientAvatar(patientInfo?.name) ?? getBasePatientAvatar(patientInfo);
}

export function getNurseAvatar(gender?: string | null): string {
	const sex = isMale(gender) ? "male" : "female";
	return avatars[`nurse_${sex}`] || avatars.nurse_female;
}

export function getUserAvatar(gender?: string | null): string {
	return getNurseAvatar(gender);
}
