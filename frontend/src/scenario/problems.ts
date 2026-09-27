/**
 * 学生侧对 `problems` 的**唯一**读法。
 *
 * 后端 `problems` 是诊断串（`dm_parse:*`、`dm_truncated:*`、`dm_provider_error:*`、
 * `unknown_actor:*`、`leaked_fact_term:*`、`unknown_option:*`…），写给维护者排查用。
 * 学生侧只保留其中一条事实：**这一回合是不是 DM 走了保底**（`dm_fallback`）——
 * 保底意味着世界回应来自脚本既定意图而不是模型即时生成，学生有权知道自己看到的东西从哪来。
 * 其余诊断串一律不进学生界面（原文只出现在管理侧会话详情）。
 */

/** 保底相关的前缀（`dm_parse:` 等带冒号后缀，所以按前缀判）。 */
const FALLBACK_PREFIXES = [
	"dm_fallback",
	"dm_parse",
	"dm_truncated",
	"dm_provider_error",
];

export const STUDENT_FALLBACK_NOTICE =
	"本回合由系统保底生成：世界的回应来自情境脚本里既定的意图，不是模型当场写的。";

/** 这一回合是否走了保底；是则给出那句人话，否则 `null`（什么都不显示）。 */
export function studentFallbackNotice(problems: string[]): string | null {
	const fellBack = problems.some((problem) =>
		FALLBACK_PREFIXES.some((prefix) => problem.startsWith(prefix)),
	);
	return fellBack ? STUDENT_FALLBACK_NOTICE : null;
}
