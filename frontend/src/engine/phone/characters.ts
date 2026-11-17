import type { EmotionVector } from "./types";

/**
 * 四个**虚构**角色 —— 演示电话的选角台。
 *
 * 刻意做成四种人：不同性别、年龄、脾气、音色与配色。没有一个是"病例"：没有主诉、
 * 没有诊断，也没有任何可评分的维度。这里只有"打给谁、她/他平时什么样"。
 *
 * 配色同时驱动 SVG 形象与页面强调色，所以同一个人在任何尺寸下都是同一张脸。
 */
export type VoiceGender = "female" | "male";

export interface PhoneCharacter {
	id: string;
	/** 名字（昵称，不是全名：电话那头的人不会自我介绍为"某某患者"）。 */
	name: string;
	gender: VoiceGender;
	age: number;
	/** 一句话概括脾气（角色卡副标题）。 */
	temperament: string;
	/** 电话用途（角色卡第三行）——都是日常问候类，不涉及病情。 */
	callAbout: string;
	/** 音色描述（纯展示；实际音色由 TTS 服务 `X-TTS-Voice` 头返回）。 */
	voice: string;
	/** 火山 TTS 2.0 实际音色 ID。 */
	speaker: string;
	/** 语速倍率（演示 TTS 播放器据此调整浏览器兜底朗读节奏）。 */
	voiceRate: number;
	/** 人物主色（SVG 衣服/背景）与强调色（页面）。 */
	palette: { primary: string; accent: string; hair: string; skin: string };
	/** 四维初始向量。 */
	initial: EmotionVector;
	/** 说话长度风格（角色卡展示 + 长回复用例的参照）。 */
	verbosity: "short" | "long";
	/** 脚本口吻标记（用在不同角色的台词前缀，纯文案）。 */
	tone: string;
}

export const PHONE_CHARACTERS: PhoneCharacter[] = [
	{
		id: "lin-wanqing",
		name: "林婉清",
		gender: "female",
		age: 28,
		temperament: "急性子，说话像连珠炮",
		callAbout: "约了晚饭，想确认几点碰面",
		voice: "明亮偏快的年轻女声",
		speaker: "zh_female_qingxinnvsheng_uranus_bigtts",
		voiceRate: 1.15,
		palette: { primary: "#e8590c", accent: "#ff922b", hair: "#2b2118", skin: "#f3d3bd" },
		initial: { trust: 0.54, anxiety: 0.2, irritation: 0.28, cooperation: 0.62 },
		verbosity: "long",
		tone: "直来直去，句子长、信息密",
	},
	{
		id: "zhou-zhenguo",
		name: "周建国",
		gender: "male",
		age: 71,
		temperament: "话少，慢慢来，不太信任陌生号码",
		callAbout: "社区打来通知体检安排",
		voice: "低沉稳重的中年男声",
		speaker: "zh_male_yuanboxiaoshu_uranus_bigtts",
		voiceRate: 0.85,
		palette: { primary: "#4c6ef5", accent: "#748ffc", hair: "#c9c9c9", skin: "#e8c9ae" },
		initial: { trust: 0.28, anxiety: 0.46, irritation: 0.2, cooperation: 0.4 },
		verbosity: "short",
		tone: "能一个字说完不说两个字",
	},
	{
		id: "su-xiaoman",
		name: "苏小满",
		gender: "female",
		age: 19,
		temperament: "紧张又客气，一直在道歉",
		callAbout: "社团活动报名出了点岔子",
		voice: "轻软、略带气声的少女声",
		speaker: "zh_female_mengyatou_uranus_bigtts",
		voiceRate: 1.0,
		palette: { primary: "#f06595", accent: "#f783ac", hair: "#5c2a3d", skin: "#f7dccb" },
		initial: { trust: 0.35, anxiety: 0.72, irritation: 0.12, cooperation: 0.78 },
		verbosity: "long",
		tone: "先道歉，再解释，绕圈",
	},
	{
		id: "he-jianfeng",
		name: "何剑峰",
		gender: "male",
		age: 45,
		temperament: "脾气冲，最烦被绕懵",
		callAbout: "对上周的一笔退款有疑问",
		voice: "沙哑、音压大的男声",
		speaker: "zh_male_wennuanahu_uranus_bigtts",
		voiceRate: 1.1,
		palette: { primary: "#2f9e44", accent: "#51cf66", hair: "#1a1a1a", skin: "#dfb68f" },
		initial: { trust: 0.3, anxiety: 0.38, irritation: 0.6, cooperation: 0.35 },
		verbosity: "short",
		tone: "短句、反问、带刺",
	},
];

export function findCharacter(id: string | null | undefined): PhoneCharacter | null {
	if (!id) return null;
	return PHONE_CHARACTERS.find((c) => c.id === id) ?? null;
}

/** 角色卡上必展示的元信息行，避免卡片各写一套。 */
export function characterFacts(c: PhoneCharacter): string[] {
	return [
		c.gender === "female" ? "女" : "男",
		`${c.age} 岁`,
		c.voice,
	];
}
