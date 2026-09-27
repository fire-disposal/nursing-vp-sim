/**
 * 学生侧对 `problems` 的**唯一**读法。
 *
 * 后端 `problems` 是诊断串（`dm_parse:*`、`dm_truncated:*`、`dm_provider_error:*`、
 * `unknown_actor:*`、`leaked_fact_term:*`、`unknown_option:*`…），写给维护者排查用。
 * 学生侧只保留其中一条事实：**这一回合的世界回应是不是照既定情境走的**（`dm_fallback`）——
 * 保底意味着它来自脚本既定的意图而不是模型当场生成，学生有权知道眼前这段从哪来。
 * 其余诊断串一律不进学生界面（原文只出现在管理侧会话详情）。
 *
 * 文案克制（2026-09-28）：**一句话、不解释机制**。此前那句把"系统/模型/脚本怎么分工"
 * 讲了一遍，属于平台在解释自己；保底要说的只有"这一段不是现场生成的"。
 */

/** 保底相关的前缀（`dm_parse:` 等带冒号后缀，所以按前缀判）。 */
const FALLBACK_PREFIXES = [
	"dm_fallback",
	"dm_parse",
	"dm_truncated",
	"dm_provider_error",
];

export const STUDENT_FALLBACK_NOTICE = "本回合的世界回应出自既定情境。";

/** 这一回合是否走了保底；是则给出那句中性说明，否则 `null`（什么都不显示）。 */
export function studentFallbackNotice(problems: string[]): string | null {
	const fellBack = problems.some((problem) =>
		FALLBACK_PREFIXES.some((prefix) => problem.startsWith(prefix)),
	);
	return fellBack ? STUDENT_FALLBACK_NOTICE : null;
}
