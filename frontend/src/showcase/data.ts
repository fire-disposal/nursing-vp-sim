import {
	Activity,
	AudioLines,
	BookOpenCheck,
	Boxes,
	HeartPulse,
	type LucideIcon,
	MessagesSquare,
} from "lucide-react";

export const PRODUCT_NAME = "虚拟患者训练系统";
export const HERO_TITLE = "把 LLM 做成可教学、可评估的虚拟患者";
export const HERO_SUBTITLE = "护理病史采集训练平台：5 个训练面板、19 项评分维度、6 种情绪状态，覆盖对话、评分与知识溯源。";
export const CTA_LABEL = "进入系统";
export const CTA_HREF = "/login";

export interface OverviewStat {
	value: number;
	suffix: string;
	label: string;
}

export const OVERVIEW_STATS: OverviewStat[] = [
	{ value: 5, suffix: " 个", label: "可配置训练面板" },
	{ value: 19, suffix: " 项", label: "评分维度" },
	{ value: 6, suffix: " 种", label: "患者情绪状态" },
];

export type HighlightLayout = "full" | "split" | "split-reverse" | "bento" | "sticky";

export interface Highlight {
	id: string;
	icon: LucideIcon;
	title: string;
	body: string;
	points: string[];
	layout: HighlightLayout;
	screenshot?: { width: number; height: number; label: string };
}

export const HIGHLIGHTS: Highlight[] = [
	{
		id: "engine",
		icon: Boxes,
		title: "训练引擎架构",
		body: "六阶段流式处理管道，按特性开关装配训练面板，组合出不同的训练场景。",
		points: [],
		layout: "full",
		screenshot: { width: 1440, height: 900, label: "1440×900（训练面板）" },
	},
	{
		id: "patient",
		icon: MessagesSquare,
		title: "LLM 虚拟患者对话",
		body: "角色扮演 + 隐藏信息逐步披露，患者会主动追问，逼近真实问诊节奏。",
		points: [
			"隐藏病史按提问逐步披露",
			"患者主动追问：按等待时长 / 信任 / 舒适度触发",
			"LLM 生成 + 规则兜底，指数退避自动停止",
		],
		layout: "split",
		screenshot: { width: 1280, height: 960, label: "1280×960（对话页）" },
	},
	{
		id: "emotion",
		icon: HeartPulse,
		title: "患者情绪系统",
		body: "基于信任-舒适二维模型，LLM 逐轮分析驱动 6 种情绪状态，立绘实时联动。",
		points: [
			"6 状态：沉默回避 / 防御抵触 / 焦虑不安 / 正常配合 / 放松友好 / 开放信任",
			"8 类患者 × 情绪变体立绘，表情与体态同步切换",
			"对话中情绪随沟通质量实时变化，信任与舒适二维量化",
			"低信任时患者回避提问、敷衍作答，高信任时主动补充病史细节",
		],
		layout: "split",
	},
	{
		id: "voice",
		icon: AudioLines,
		title: "语音交互",
		body: "火山引擎 TTS 流式，情绪联动音色，双路提供方与优雅降级。",
		points: [
			"SeedTTS 2.0 合成 + 流式播报",
			"双路：火山引擎 + 自行部署",
			"熔断保护，失败自动降级",
		],
		layout: "split-reverse",
	},
	{
		id: "scoring",
		icon: Activity,
		title: "流式评分 + 透明化",
		body: "SSE 逐项推送评分结果，配合证据回链与理由展开，便于快速查看与复核。",
		points: [
			"19 项维度：沟通技能 14 + 病史采集 5",
			"每项附对话证据与评分理由",
			"评分结果可直接回看对话上下文",
		],
		layout: "split",
		screenshot: { width: 1440, height: 900, label: "1440×900（评分页）" },
	},
	{
		id: "rag",
		icon: BookOpenCheck,
		title: "教材知识库 RAG",
		body: "关键词 / IDF 加权检索 + 层级章节浏览，引用出处可溯源回教材原文。",
		points: [
			"章节浏览作为 LLM Tool Call 暴露，模型可主动翻阅教材",
			"引用附带教材原文链接，可一键跳转验证出处",
			"覆盖《内科护理学》《健康评估》等核心教材章节",
			"支持按章节层级逐级下钻，精准定位知识点",
			"原生 Markdown 格式适配，易于快速扩展与定制知识库",
		],
		layout: "split-reverse",
	},
];

export const TECH_STACK: string[] = [
	"React 19",
	"TypeScript",
	"Vite",
	"Tailwind CSS",
	"TanStack Query",
	"GSAP",
	"Biome",
	"FastAPI",
	"PostgreSQL",
	"SQLAlchemy",
	"Alembic",
	"Ruff",
	"Docker",
	"GitHub Actions",
	"DeepSeek",
	"火山引擎 TTS",
	"pnpm",
];

export interface DialogueLine {
	speaker: "nurse" | "patient";
	text: string;
	emotion?: string;
}

export interface ExampleConversation {
	id: string;
	title: string;
	emotionLabel: string;
	lines: DialogueLine[];
}

export const EXAMPLE_CONVERSATIONS: ExampleConversation[] = [
	{
		id: "normal",
		title: "正常配合",
		emotionLabel: "正常配合 · Normal",
		lines: [
			{
				speaker: "nurse",
				text: "您好，我是您今天的责任护士。请问您今天感觉怎么样，哪里不舒服？",
			},
			{
				speaker: "patient",
				text: "你好。最近总觉得胸口闷，一走路就喘不上气，这种情况大概有两周了。晚上躺下的时候会加重，得垫高枕头才能睡着。",
				emotion: "正常配合",
			},
			{
				speaker: "nurse",
				text: "明白了。以前有过心脏病或高血压吗？最近有没有服药？",
			},
			{
				speaker: "patient",
				text: "之前体检说血压有点高，但没当回事，也没吃药。我父亲有冠心病，这个会遗传吗？",
				emotion: "正常配合",
			},
		],
	},
	{
		id: "defensive",
		title: "防御抵触",
		emotionLabel: "防御抵触 · Defensive",
		lines: [
			{
				speaker: "nurse",
				text: "您好，能跟我讲讲您今天为什么来就诊吗？",
			},
			{
				speaker: "patient",
				text: "……没什么大事。就是有点累，家里人非要我来。",
				emotion: "防御抵触",
			},
			{
				speaker: "nurse",
				text: "家人关心您是好事。能具体说说哪里不舒服吗？我会认真听的。",
			},
			{
				speaker: "patient",
				text: "……行吧。最近肚子老是疼，吃了饭就更疼。之前在别的医院看过，开了药也没用，懒得再说了。",
				emotion: "防御抵触",
			},
		],
	},
	{
		id: "trusting",
		title: "开放信任",
		emotionLabel: "开放信任 · Trusting",
		lines: [
			{
				speaker: "nurse",
				text: "您刚才提到最近睡眠不太好，能详细说说吗？",
			},
			{
				speaker: "patient",
				text: "你问得很仔细，我再仔细想想……其实不只是睡不着，半夜总会醒两三次，醒了就很难再入睡。",
				emotion: "开放信任",
			},
			{
				speaker: "nurse",
				text: "这种状况大概持续多久了？白天会觉得困倦吗？",
			},
			{
				speaker: "patient",
				text: "有一个多月了。白天确实没精神，还有点烦躁。对了，我去年做过一次胃镜，报告说有浅表性胃炎，这个会影响睡眠吗？",
				emotion: "开放信任",
			},
		],
	},
];

export interface TtsDemoItem {
	id: string;
	label: string;
	emotionClass: string;
	patientText: string;
	fileName: string;
}

export const TTS_DEMO_ITEMS: TtsDemoItem[] = [
	{
		id: "neutral",
		label: "正常配合",
		emotionClass: "bg-emerald-500",
		patientText: "你好。最近胸口闷得厉害，一走路就喘不上气，晚上躺下更严重，得垫两个枕头才能睡着。",
		fileName: "tts-patient-neutral.wav",
	},
	{
		id: "defensive",
		label: "防御抵触",
		emotionClass: "bg-rose-500",
		patientText: "……反正也查不出什么。就是累，浑身没劲，家里人非要我来。",
		fileName: "tts-patient-defensive.wav",
	},
	{
		id: "trusting",
		label: "开放信任",
		emotionClass: "bg-sky-500",
		patientText: "你问得这么仔细，我再想想……对了，我母亲也有心脏病，这个会遗传吗？我平时该注意什么？",
		fileName: "tts-patient-trusting.wav",
	},
	{
		id: "anxious",
		label: "焦虑不安",
		emotionClass: "bg-amber-500",
		patientText: "护士，我咳出的痰里怎么有血丝？是不是很严重？你得跟我说实话。",
		fileName: "tts-patient-anxious.wav",
	},
];
