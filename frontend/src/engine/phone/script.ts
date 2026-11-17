import type { PhoneCharacter } from "./characters";
import type { ScriptIntent } from "./types";

/**
 * 本地文本工具 —— 角色说什么由后端 LLM（权威 Prompt）决定，这里只剩三件纯函数：
 *   1. `classifyUserText`：学生这句话的意图（正则，仅用于情绪加权与界面标签）；
 *   2. `openingLine`：拨号时的固定开场白（确定性，不等模型，通话立刻有人声）；
 *   3. `truncateForInterrupt`：被打断时保留她已经念出去的整句。
 *
 * 注意：这里**不限制**学生能说什么。自由输入是演示的核心，未命中规则的文本
 * 一律落到 `other` 并照常送进模型。
 */

const INTENT_RULES: Array<{ intent: ScriptIntent; test: RegExp }> = [
	{ intent: "greeting", test: /(你好|您好|早上好|下午好|晚上好|在吗|最近好吗|最近怎么样|hi|hello)/i },
	// "我理解你的担心"同时命中 empathy 与 emotion_probe 的词：先判共情，
	// 否则一句安慰会被读成"你在盘问我的情绪"。
	{
		intent: "empathy",
		test: /(理解|明白|知道|抱歉|不好意思|谢谢|辛苦|陪着|我陪你|放心|不着急|慢慢说|没事|别担心)/,
	},
	{ intent: "emotion_probe", test: /(心情|情绪|感觉|怎么想|担心|紧张|委屈|还好吗|高兴|难过|生气)/ },
	{ intent: "question", test: /([？?]|吗|呢|多少|几点|什么|怎么|为什么|能不能|可以|是不是)/ },
];

/** 输入意图判定：纯规则，不调用任何模型，也不阻断任何输入。 */
export function classifyUserText(text: string): ScriptIntent {
	const t = text.trim();
	if (!t) return "other";
	for (const rule of INTENT_RULES) {
		if (rule.test.test(t)) return rule.intent;
	}
	return "other";
}

/** 开场白：每个角色一句固定台词（确定性，拨号即有声音）。 */
export const OPENING_LINES: Record<string, string> = {
	"lin-wanqing": "喂？我这边几分钟后就到楼下了，你人在哪儿呢。",
	"zhou-zhenguo": "喂，我是周建国。",
	"su-xiaoman": "喂……你好，我是小满，不好意思突然打电话。",
	"he-jianfeng": "喂，我这有个事得说清楚。",
};

export function openingLine(character: PhoneCharacter): string {
	return OPENING_LINES[character.id] ?? "喂，你好。";
}

/**
 * 打断截断：按标点切句，只保留**完整念完**的句子。
 *
 * `spokenChars` 是播放器给出的朗读位置（没有进度时为 0 → 返回空串，
 * 也就是"被打断时她只是被噎住了"）。
 */
export function truncateForInterrupt(text: string, spokenChars: number): string {
	if (spokenChars >= text.length) return text;
	const head = text.slice(0, Math.max(0, spokenChars));
	const lastStop = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"));
	return lastStop >= 0 ? head.slice(0, lastStop + 1) : "";
}
