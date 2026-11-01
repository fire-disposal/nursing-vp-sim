import type { EmotionState } from "@/stores/trainingStore";
import nurseFemale from "../assets/avatars/simple/nurse_female.png";
import nurseMale from "../assets/avatars/simple/nurse_male.png";

/** 员工（护士）头像：平台账号没有病例照片，只有这两张固定图。 */
const staffAvatars: Record<string, string> = {
	nurse_male: nurseMale,
	nurse_female: nurseFemale,
};

/**
 * 论文展示病例专属写实头像：按患者姓名精确绑定（患者区/聊天气泡两处都能命中）。
 * 图片放在 realistic/ 目录，用 import.meta.glob 动态加载：
 *   - 图片尚未放入时 glob 为空，自动回退到程序化绘制，构建不受影响；
 *   - PNG 一旦放入即被自动加载，无需改动代码。
 *   - 资源命名遵循病例头像的当前产品约定；生成或替换头像不改变训练逻辑。
 */
const realisticAvatarModules = import.meta.glob<{ default: string }>(
	"../assets/avatars/realistic/*.png",
	{ eager: true },
);

const realisticAvatarsByName: Record<string, string> = {
	"王建国": "case-chest-pain-elder-male.png",
	"张美华": "case-fever-middle-female.png",
};

/**
 * 情绪立绘映射（病例 ``patient_info.portrait_states``）：情绪键 → 立绘 URL。
 * 同一患者可以有任意多张（0~6）按情绪切换的立绘；键的闭集由后端发布门禁把关。
 */
export type PortraitStates = Partial<Record<EmotionState, string>>;

/** 写实画风路由器：按患者姓名取论文专属写实头像；未绑定或文件缺失返回 null（交给程序化绘制）。 */
export function getRealisticPatientAvatar(name?: string | null): string | null {
	if (!name) return null;
	const filename = realisticAvatarsByName[name];
	if (!filename) return null;
	const mod = realisticAvatarModules[`../assets/avatars/realistic/${filename}`];
	return mod ? mod.default : null;
}

export function getNurseAvatar(gender?: string | null): string {
	// 病例/账号里的性别有中文与英文两种写法，这里统一收成文件名后缀。
	const sex = gender === "男" || gender === "male" ? "male" : "female";
	return staffAvatars[`nurse_${sex}`] || staffAvatars.nurse_female;
}

export function getUserAvatar(gender?: string | null): string {
	return getNurseAvatar(gender);
}
