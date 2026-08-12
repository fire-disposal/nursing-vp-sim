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

export interface CommandSurface {
	assessments: Record<string, string>;
	drugs: Record<string, string>;
	labs: Record<string, string>;
	talk_roles: string[];
	wait_labs: boolean;
	monitor: boolean;
}

const DEFAULT_SURFACE: CommandSurface = {
	assessments: {
		vitals: "生命体征",
		drain: "引流",
		pain: "疼痛",
		urine: "尿量",
		glucose: "血糖",
		breath: "肺部听诊",
	},
	drugs: {
		FLUIDS: "快速补液",
		TRANSFUSE: "输注红细胞",
		MORPHINE: "吗啡",
		NSAID: "布洛芬",
		OXYGEN: "给氧",
		DIURETIC: "呋塞米",
		VASOPRESSOR: "去甲肾上腺素",
		ANTIBIOTIC: "抗生素",
		INSULIN: "胰岛素",
		GLUCOSE: "静脉葡萄糖",
		SALBUTAMOL: "沙丁胺醇",
	},
	labs: { CBC: "血常规(CBC)", ABG: "动脉血气(ABG)", COAG: "凝血功能", US: "腹部超声" },
	talk_roles: ["patient", "family"],
	wait_labs: true,
	monitor: true,
};

const HELP: CommandDef = {
	cmd: "help",
	desc: "分级命令帮助",
	params: ["assess", "order", "view", "give", "talk", "处理"],
	paramDesc: { assess: "评估目标与耗时", order: "可申请检查、费用与周转", view: "查看结果说明", give: "药物与剂量", talk: "对话对象", 处理: "报告 / 等待说明" },
};

export function buildCommandGroups(surface: CommandSurface = DEFAULT_SURFACE): CommandGroup[] {
	const assess: CommandDef = {
		cmd: "assess",
		desc: "主动评估观察（消耗时间）",
		params: Object.keys(surface.assessments),
		paramDesc: surface.assessments,
	};
	const labParams = Object.fromEntries(
		Object.entries(surface.labs).map(([k, label]) => [k.toLowerCase(), label]),
	);
	const order: CommandDef = { cmd: "order", desc: "申请检查（扣预算，各带周转）", params: Object.keys(labParams), paramDesc: labParams };
	const view: CommandDef = { cmd: "view", desc: "查看已返回检查结果", params: Object.keys(labParams), paramDesc: labParams };
	const give: CommandDef = {
		cmd: "give",
		desc: "给药（耗治疗点，剂量可选）",
		params: Object.keys(surface.drugs),
		paramDesc: Object.fromEntries(Object.entries(surface.drugs).map(([k, label]) => [k, `${label}：/give ${k} [剂量]`])),
	};
	const talk: CommandDef = {
		cmd: "talk",
		desc: "与患者或家属对话（2min）：/talk <对象> <你的话>",
		params: surface.talk_roles,
		paramDesc: Object.fromEntries(surface.talk_roles.map((r) => [r, `与${r}交谈`])),
	};
	const report: CommandDef = { cmd: "report", desc: "向医生报告（需已有异常证据）", params: ["doctor"], paramDesc: { doctor: "向医生报告病情（2min）" } };
	const wait: CommandDef = {
		cmd: "wait",
		desc: surface.wait_labs ? "等待至下一事件，或 /wait <检查> 等指定检查" : "等待至下一可见中断事件",
		params: surface.wait_labs ? Object.keys(labParams) : undefined,
		paramDesc: surface.wait_labs ? labParams : undefined,
	};
	const monitor: CommandDef = surface.monitor
		? { cmd: "monitor", desc: "开启持续生命体征监护", params: ["vitals"], paramDesc: { vitals: "开启持续监护（2min）" } }
		: { cmd: "monitor", desc: "开启持续生命体征监护" };

	return [
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
		{ name: "评估", desc: "主动观察", commands: [assess] },
		{ name: "检查", desc: "申请与查看", commands: [order, view] },
		{
			name: "给药",
			desc: "治疗与支持（均有副作用，注意剂量）",
			commands: [give, { cmd: "consult", desc: "专家会诊 120检查点（AI 基于已知信息给建议与检查方向）" }],
		},
		{ name: "对话", desc: "与患者 / 家属交谈（LLM 扮演，仅基于已知观察）", commands: [talk] },
		{
			name: "处理",
			desc: "监护 / 诊断 / 报告 / 等待",
			commands: [
				{ cmd: "diag", desc: "记录你的诊断/推理（自由文本）" },
				monitor,
				report,
				wait,
			],
		},
	];
}

export const COMMAND_GROUPS: CommandGroup[] = buildCommandGroups();

/** Flat view used for prefix matching. */

