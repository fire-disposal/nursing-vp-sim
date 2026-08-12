/** 中文指令触发词 — 命令头 + 常用参数的别名表（单一事实源）。
 *
 * 玩家可用中文或英文输入，parser 统一翻译为后端认识的英文 key。
 * 命令头是稳定的（15 个），参数是全局注册的 key（评估目标/药物/检查/对话对象），
 * 均为稳定枚举，故此处静态映射即可，不与病例 surface 脱节（surface 只是备药子集）。
 */

// 命令头中文别名 → 小写英文命令名
export const COMMAND_ALIASES: Record<string, string> = {
	状态: "status",
	情况: "status",
	评估: "assess",
	查体: "assess",
	查: "assess",
	检查: "order",
	开单: "order",
	查看: "view",
	结果: "view",
	监护: "monitor",
	会诊: "consult",
	请教: "consult",
	对话: "talk",
	问: "talk",
	诊断: "diag",
	判断: "diag",
	给药: "give",
	用药: "give",
	报告: "report",
	汇报: "report",
	等待: "wait",
	等: "wait",
	历史: "history",
	帮助: "help",
	待办: "pending",
	进行中: "pending",
	病例: "case",
};

// 参数中文别名 → 英文 key（大小写与后端约定一致）。
export const TARGET_ALIASES: Record<string, string> = {
	// 评估目标
	生命体征: "vitals",
	引流: "drain",
	疼痛: "pain",
	尿量: "urine",
	血糖: "glucose",
	肺部听诊: "breath",
	呼吸音: "breath",
	// 药物
	快速补液: "FLUIDS",
	补液: "FLUIDS",
	输注红细胞: "TRANSFUSE",
	输血: "TRANSFUSE",
	吗啡: "MORPHINE",
	布洛芬: "NSAID",
	给氧: "OXYGEN",
	吸氧: "OXYGEN",
	呋塞米: "DIURETIC",
	利尿: "DIURETIC",
	去甲肾上腺素: "VASOPRESSOR",
	升压: "VASOPRESSOR",
	抗生素: "ANTIBIOTIC",
	胰岛素: "INSULIN",
	静脉葡萄糖: "GLUCOSE",
	葡萄糖: "GLUCOSE",
	沙丁胺醇: "SALBUTAMOL",
	// 检查
	血常规: "CBC",
	血气: "ABG",
	凝血: "COAG",
	超声: "US",
	// 对话对象
	患者: "patient",
	家属: "family",
};

/** 英文 key → 首选中文名（补全面板显示用）。 */
export const EN_TO_ZH: Record<string, string> = {
	vitals: "生命体征",
	drain: "引流",
	pain: "疼痛",
	urine: "尿量",
	glucose: "血糖",
	breath: "肺部听诊",
	FLUIDS: "补液",
	TRANSFUSE: "输血",
	MORPHINE: "吗啡",
	NSAID: "布洛芬",
	OXYGEN: "给氧",
	DIURETIC: "呋塞米",
	VASOPRESSOR: "升压药",
	ANTIBIOTIC: "抗生素",
	INSULIN: "胰岛素",
	GLUCOSE: "葡萄糖",
	SALBUTAMOL: "沙丁胺醇",
	CBC: "血常规",
	ABG: "血气",
	COAG: "凝血",
	US: "超声",
	patient: "患者",
	family: "家属",
};
/** 中文参数 → 英文 key；英文输入原样返回（大小写交给后端/后续规范化）。 */
export function translateTarget(raw: string): string {
	const t = raw.trim();
	return TARGET_ALIASES[t] ?? TARGET_ALIASES[t.toLowerCase()] ?? t;
}

/** 命令头 → 小写英文命令名；英文原样通过。 */
export function translateCommand(head: string): string {
	const h = head.toLowerCase();
	return COMMAND_ALIASES[h] ?? h;
}
