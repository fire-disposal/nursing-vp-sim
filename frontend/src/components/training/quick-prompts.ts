import type { PatientData } from "@/engine/types";

const DEFAULT_PROMPT = "您好，请跟我说说您今天的情况";

/**
 * 根据主诉生成引导模式的建议开场问句。
 *
 * 门控在调用方 `WelcomeScreen.tsx`：只有引导模式（`mode === "guided"`）且拿到
 * `onQuickPrompt` 时才展示；考核与盲盒模式不展示，避免泄露评分点。
 */
export function getGuidedQuickPrompts(patient: PatientData | null): string[] {
	if (!patient) return [DEFAULT_PROMPT];
	const cc = patient.chiefComplaint;
	if (!cc) return [DEFAULT_PROMPT];
	const primary = cc.includes("胸痛")
		? "请详细描述一下胸痛的感觉和持续时间"
		: cc.includes("发热")
			? "发热是从什么时候开始的？最高体温多少？"
			: cc.includes("呼吸")
				? "呼吸困难是从什么时候开始的？加重因素是什么？"
				: cc.includes("咳嗽")
					? "咳嗽多久了？有没有痰？什么颜色？"
					: `请跟我说说您的${cc}是怎么回事`;
	return [primary, DEFAULT_PROMPT];
}
