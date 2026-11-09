import type {
	ClinicalEvidence,
	ClinicalJudgmentState,
} from "@/api/clinical-reasoning";

/**
 * 呈现层的纯函数集合：只做**排版映射**，不做判定。
 *
 * 证据是否出现、目标是否完成，全部由服务端 `state` 决定；这里回答的只有
 * "这条证据归到哪条途径、显示什么名字、拿到它的那一刻要不要高亮"。
 */

/** 证据途径 → 中文短标签（学生看到的分类，不是内部 kind 名）。 */
export const EVIDENCE_KIND_LABEL: Record<ClinicalEvidence["kind"], string> = {
	vital_sign: "生命体征",
	exam: "床旁体征",
	lab: "检验",
	history: "病史",
	observation: "观察",
};

/** 证据途径的展示顺序：从"最客观的读数"到"最依赖追问的叙述"。 */
export const EVIDENCE_KIND_ORDER: ClinicalEvidence["kind"][] = [
	"vital_sign",
	"exam",
	"lab",
	"observation",
	"history",
];

export interface EvidenceGroup {
	kind: ClinicalEvidence["kind"];
	label: string;
	items: ClinicalEvidence[];
}

/** 按途径分组（保持稳定顺序；空组不出现，避免"标题 + 空"的噪声）。 */
export function groupEvidenceByKind(evidence: ClinicalEvidence[]): EvidenceGroup[] {
	return EVIDENCE_KIND_ORDER.map((kind) => ({
		kind,
		label: EVIDENCE_KIND_LABEL[kind],
		items: evidence.filter((item) => item.kind === kind),
	})).filter((group) => group.items.length > 0);
}

/** 判断进度：已确认的关键线索 / 总数。总数缺失时返回 `null`（不画假进度条）。 */
export function noticeProgress(state: ClinicalJudgmentState): { done: number; total: number } | null {
	const { notice_count, notice_total } = state.objectives;
	if (notice_total <= 0) return null;
	return { done: Math.min(notice_count, notice_total), total: notice_total };
}

export interface ObjectiveTally {
	actDone: number;
	actTotal: number;
	communicateDone: number;
	communicateTotal: number;
}

export function objectiveTally(state: ClinicalJudgmentState): ObjectiveTally {
	const { must_act, must_communicate } = state.objectives;
	return {
		actDone: must_act.filter((item) => item.completed).length,
		actTotal: must_act.length,
		communicateDone: must_communicate.filter((item) => item.completed).length,
		communicateTotal: must_communicate.length,
	};
}



/**
 * 本轮新到的证据 —— 「浮现 + 联结」的触发器。
 *
 * 对比前后两份状态里**已知的 finding_id 集合**：新出现的即本轮获得。首次加载
 * （`previous` 为 null）不算"新到"，否则一进页面全体高亮，记忆点就废了。
 * 返回顺序保持服务端给的证据顺序（学生的阅读顺序）。
 */
export function newlyObservedEvidence(
	previousIds: ReadonlySet<string> | null,
	evidence: ClinicalEvidence[],
): ClinicalEvidence[] {
	if (previousIds === null) return [];
	return evidence.filter((item) => !previousIds.has(item.finding_id));
}

/**
 * 判断进度的文案。总数缺失（= 病例没声明必发现线索）时返回 `null`：
 * 页面据此显示 "—" 而不是画一条 0/0 的假进度。
 */
export function noticeCountLabel(state: ClinicalJudgmentState): { done: number; total: number; label: string } | null {
	const progress = noticeProgress(state);
	if (!progress) return null;
	return { ...progress, label: `${progress.done} / ${progress.total} 条关键线索` };
}
