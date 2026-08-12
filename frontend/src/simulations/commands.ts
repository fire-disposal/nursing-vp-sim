/** Command catalog for the autocomplete panel — mirrors the backend's
 * hierarchical help (groups: 信息/评估/检查/干预/处理) so the console hints
 * commands and their parameters in a folded, parameterized way. */

export interface CommandDef {
	cmd: string;
	desc: string;
	/** Sub-targets for drill-down commands (e.g. /assess <vitals|drain|…>). */
	params?: string[];
	paramDesc?: Record<string, string>;
}

export interface CommandGroup {
	name: string;
	desc: string;
	commands: CommandDef[];
}

export interface Completion {
	/** Text to fill into the input when clicked. */
	text: string;
	label: string;
	desc: string;
}

const LAB_PARAMS = {
	cbc: "血常规 35检查点/15min",
	abg: "动脉血气 60检查点/10min",
	coag: "凝血功能 50检查点/20min",
	us: "腹部超声 120检查点/20min",
};

const ASSESS: CommandDef = {
	cmd: "assess",
	desc: "主动评估观察（消耗时间）",
	params: ["vitals", "drain", "pain", "urine"],
	paramDesc: {
		vitals: "生命体征 HR/BP/RR/SpO2/T（2min）",
		drain: "引流量（3min）",
		pain: "疼痛 VAS（1min）",
		urine: "尿量（2min）",
	},
};

const ORDER: CommandDef = { cmd: "order", desc: "申请检查（扣预算，各带周转）", params: ["cbc", "abg", "coag", "us"], paramDesc: LAB_PARAMS };
const VIEW: CommandDef = { cmd: "view", desc: "查看已返回检查结果", params: ["cbc", "abg", "coag", "us"], paramDesc: LAB_PARAMS };

const GIVE: CommandDef = { cmd: "give", desc: "快速补液（30治疗点）", params: ["fluids"], paramDesc: { fluids: "补液 500ml（30治疗点/3min）：争取时间但掩盖血压" } };
const REPORT: CommandDef = { cmd: "report", desc: "向医生报告（需已有异常证据）", params: ["doctor"], paramDesc: { doctor: "向医生报告病情（2min）" } };
const HELP: CommandDef = {
	cmd: "help",
	desc: "分级命令帮助",
	params: ["assess", "order", "view", "干预", "处理"],
	paramDesc: { assess: "评估目标与耗时", order: "可申请检查、费用与周转", view: "查看结果说明", 干预: "干预说明", 处理: "报告 / 等待说明" },
};

export const COMMAND_GROUPS: CommandGroup[] = [
	{
		name: "信息",
		desc: "状态 / 历史 / 进行中 / 帮助",
		commands: [
			{ cmd: "status", desc: "查看已知状态、目标清单与预算" },
			{ cmd: "history", desc: "查看已发生动作" },
			{ cmd: "pending", desc: "查看进行中检查" },
			{ cmd: "case", desc: "查看 / 切换病例（切换将开启新局）" },
			HELP,
		],
	},
	{ name: "评估", desc: "主动观察（4 个目标）", commands: [ASSESS] },
	{ name: "检查", desc: "申请与查看（4 个项目）", commands: [ORDER, VIEW] },
	{
		name: "干预",
		desc: "治疗与支持（有取舍）",
		commands: [
			GIVE,
			{ cmd: "transfuse", desc: "输注红细胞 2U（60治疗点/5min）：放缓失血" },
			{ cmd: "analgesia", desc: "给予镇痛（20治疗点/1min）：可能掩盖腹痛" },
			{ cmd: "consult", desc: "专家会诊 120检查点（AI 基于已知信息给建议与检查方向）" },
		],
	},
	{
		name: "对话",
		desc: "与患者 / 家属交谈（LLM 扮演，仅基于已知观察）",
		commands: [
			{
				cmd: "talk",
				desc: "与患者或家属对话（2min）：/talk patient <你的话>",
				params: ["patient", "family"],
				paramDesc: {
					patient: "问患者本人：/talk patient 你现在感觉怎么样？",
					family: "问陪护家属：/talk family 他夜里睡得怎么样？",
				},
			},
		],
	},
	{
		name: "处理",
		desc: "监护 / 诊断 / 报告 / 等待",
		commands: [
			{ cmd: "diag", desc: "记录你的诊断/推理（自由文本）" },
			{ cmd: "monitor", desc: "开启持续生命体征监护", params: ["vitals"], paramDesc: { vitals: "开启持续监护（2min）" } },
			REPORT,
			{ cmd: "wait", desc: "等待至下一可见中断事件" },
			{ cmd: "wait cbc", desc: "等待最近一次 pending CBC 返回" },
		],
	},
];

/** Flat view used for prefix matching. */
export const COMMANDS: CommandDef[] = COMMAND_GROUPS.flatMap((g) => g.commands);
