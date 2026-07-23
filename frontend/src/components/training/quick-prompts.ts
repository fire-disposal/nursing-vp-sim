import type { PatientData } from "@/engine/types";

const FALLBACK = "您好，请跟我说说您今天的情况";

/**
 * 根据主诉生成快捷问句。
 * 仅用于练习模式辅助（WelcomeScreen 开场 + QuickPromptBar 对话中）；
 * 作业/考核路径不展示（from_assignment 门控），避免泄露评分点。
 */
export function getQuickPrompts(patient: PatientData | null): string[] {
	if (!patient) return [FALLBACK];
	const cc = patient.chiefComplaint;
	if (!cc) return [FALLBACK];
	const primary = cc.includes("胸痛")
		? "请详细描述一下胸痛的感觉和持续时间"
		: cc.includes("发热")
			? "发热是从什么时候开始的？最高体温多少？"
			: cc.includes("呼吸")
				? "呼吸困难是从什么时候开始的？加重因素是什么？"
				: cc.includes("咳嗽")
					? "咳嗽多久了？有没有痰？什么颜色？"
					: `请跟我说说您的${cc}是怎么回事`;
	return [primary, FALLBACK];
}

/** 对话中补充的通用问句（主诉无关，练习模式专用） */
export const EXTRA_CHAT_PROMPTS: string[] = [
	"这种感觉持续多久了？",
	"之前有过类似的情况吗？",
];
