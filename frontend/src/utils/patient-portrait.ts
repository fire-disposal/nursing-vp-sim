import type { PatientInfo } from "./avatar";
import { getPatientAvatar, getPatientKey } from "./avatar";

const variantModules = import.meta.glob<{ default: string }>(
	"@/assets/avatars/*-{a,h,s,n}.png",
	{ eager: true },
);

const variantMap: Record<string, string> = {};
for (const [filePath, mod] of Object.entries(variantModules)) {
	const filename = filePath.split("/").pop()?.replace(".png", "") ?? "";
	variantMap[filename] = mod.default;
}

const EMOTION_SUFFIX: Record<string, string> = {
	withdrawn: "-s",
	defensive: "-a",
	neutral: "",
	relaxed: "-h",
	open: "-h",
};

export function getPatientPortraitUrl(
	patientInfo?: PatientInfo | null,
	emotion?: string | null,
): string {
	if (!emotion) return getPatientAvatar(patientInfo);
	const suffix = EMOTION_SUFFIX[emotion];
	if (!suffix) return getPatientAvatar(patientInfo);
	const key = getPatientKey(patientInfo);
	return variantMap[`${key}${suffix}`] || getPatientAvatar(patientInfo);
}
