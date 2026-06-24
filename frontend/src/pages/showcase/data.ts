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
		points: [
			"管道：守卫 → 转换 → 提示 → LLM → 持久化 → 副作用",
			"5 个可配置面板：问诊 / 查体 / 护理记录 / 情绪 / 自主反馈",
			"特性开关驱动，按需启用能力",
		],
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
			"8 类患者 × 情绪变体立绘",
			"对话中情绪随沟通质量动态变化",
		],
		layout: "bento",
	},
	{
		id: "voice",
		icon: AudioLines,
		title: "语音交互",
		body: "火山引擎 TTS / ASR 流式，情绪联动音色，双路提供方与优雅降级。",
		points: [
			"SeedTTS 2.0 合成 + BigASR 流式识别",
			"双路：火山引擎 + 浏览器兜底",
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
		layout: "sticky",
		screenshot: { width: 1440, height: 900, label: "1440×900（评分页）" },
	},
	{
		id: "rag",
		icon: BookOpenCheck,
		title: "教材知识库 RAG",
		body: "关键词 / IDF 加权检索 + 层级章节浏览，引用出处可溯源回教材原文。",
		points: [
			"章节浏览作为 LLM Tool Calls 暴露",
			"关键词 / IDF 加权检索，中文停用词过滤",
			"引用可点击回看教材原文",
		],
		layout: "bento",
	},
];

export interface Chip {
	label: string;
}

export const ENGINEERING: Chip[] = [
	{ label: "多 Provider 路由" },
	{ label: "熔断 / 限流" },
	{ label: "月度成本上限" },
	{ label: "流式 SSE" },
	{ label: "LLM 调用日志" },
	{ label: "统一成本面板" },
	{ label: "运维面板 + 自动告警" },
	{ label: "CI/CD 自动部署" },
];

export const TECH_STACK: string[] = [
	"React 19",
	"FastAPI",
	"PostgreSQL",
	"SQLAlchemy",
	"Alembic",
	"DeepSeek",
	"火山引擎 TTS·ASR",
];
