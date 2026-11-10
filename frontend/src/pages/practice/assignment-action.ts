/**
 * 学生作业详情 —— 主行动（唯一 CTA）的决策。
 *
 * 纯函数、无 React/网络依赖：这一页最容易出错的地方不是排版，而是「什么时候能点开始」。
 * 规则集中在一处，页面只负责把它渲染成按钮，测试也只钉行为（给什么数据 → 给什么动作），
 * 不去镜像组件内部结构。
 */
import type { StudentAssignmentDetail } from "@/api/assignments";

export type AssignmentActionKind =
	/** 未开始 / 还能再练一次 → 调 start-from-assignment */
	| "start"
	/** 有进行中记录且未过期 → 直接回到那条记录 */
	| "resume"
	/** 已完成且已用完次数 → 只能看复盘 */
	| "review"
	/** 已关闭 / 已截止 → 只能看历史 */
	| "none";

export interface AssignmentAction {
	kind: AssignmentActionKind;
	label: string;
	/** kind=resume 时的目标记录 */
	recordId: number | null;
	/** kind=start 时是否属于「重练」（文案与提示不同） */
	isRetry: boolean;
	/** 展示给学生的解释：为什么只能看历史 / 为什么不能开始 */
	hint: string | null;
}

const NO_ATTEMPTS_LEFT_HINT = "已达最大尝试次数，无法再开始新的练习。";

/**
 * 作业是否已经不能开始新的尝试。
 *
 * 关闭优先于截止（与服务端 ``effective_status`` 同序）：教师手动关闭后，
 * 即便没到截止时间也不能开始。
 */
export function isAssignmentLocked(detail: Pick<StudentAssignmentDetail, "lifecycle">): boolean {
	return detail.lifecycle === "closed" || detail.lifecycle === "ended";
}

export function resolveAssignmentAction(detail: StudentAssignmentDetail): AssignmentAction {
	const attemptsLeft = detail.remaining_attempts;

	if (isAssignmentLocked(detail)) {
		return {
			kind: "none",
			label: "作业已结束",
			recordId: detail.record_id,
			isRetry: false,
			hint:
				detail.lifecycle === "closed"
					? "教师已关闭这次作业，仍可查看历史尝试与复盘。"
					: "已过截止时间，仍可查看历史尝试与复盘。",
		};
	}

	// 进行中优先于次数字：在途记录不消耗次数，继续它永远允许
	if (detail.status === "in_progress" && detail.record_id) {
		return {
			kind: "resume",
			label: "继续练习",
			recordId: detail.record_id,
			isRetry: false,
			hint: null,
		};
	}

	const canStart = attemptsLeft === null || attemptsLeft === undefined || attemptsLeft > 0;

	if (detail.status === "completed" || detail.attempt_count > 0) {
		if (canStart) {
			return {
				kind: "start",
				label: "再练一次",
				recordId: null,
				isRetry: true,
				hint: attemptsLeft === null ? null : `还可以练习 ${attemptsLeft} 次。`,
			};
		}
		return {
			kind: "review",
			label: "查看复盘",
			recordId: detail.record_id,
			isRetry: false,
			hint: NO_ATTEMPTS_LEFT_HINT,
		};
	}

	if (!canStart) {
		// 未开始但次数已用完（次数被教师调小）：只能看历史
		return {
			kind: "none",
			label: "无法开始",
			recordId: null,
			isRetry: false,
			hint: NO_ATTEMPTS_LEFT_HINT,
		};
	}

	return { kind: "start", label: "开始练习", recordId: null, isRetry: false, hint: null };
}

/** 训练方式文案：服务端给的是行为配置里的枚举值。 */
export function modeLabel(mode: string): string {
	switch (mode) {
		case "guided":
			return "引导式练习";
		case "assessment":
			return "考核式练习";
		default:
			return "标准练习";
	}
}

/** 尝试规则文案：0 / null = 不限制。 */
export function attemptRuleLabel(detail: Pick<StudentAssignmentDetail, "max_attempts" | "attempt_count">): string {
	const limit = detail.max_attempts;
	if (!limit || limit <= 0) return `不限次数（已练习 ${detail.attempt_count} 次）`;
	return `最多 ${limit} 次（已用 ${detail.attempt_count} 次）`;
}

/** 预计时限文案：null = 服务端未给出（不编造默认值）。 */
export function timeLimitLabel(minutes: number | null | undefined): string {
	if (minutes === null || minutes === undefined || minutes <= 0) return "—";
	return `${minutes} 分钟`;
}

/**
 * 必交产物文案。
 *
 * 空列表**必须显式说「无额外必交」**：留空的标签会让学生以为「还没加载出来」
 * 或者「老师没要求就不管了」，而这两者都不是事实 —— 事实是本病例交卷不设门禁。
 */
export function requiredArtifactsLabel(artifacts: { kind: string; label: string }[]): string {
	if (artifacts.length === 0) return "无额外必交（结束训练即可交卷）";
	return artifacts.map((item) => item.label || item.kind).join("、");
}

/** 需要完成的操作文案：空列表表示本病例没有配右侧面板操作。 */
export function requiredActivitiesLabel(activities: { id: string; label: string }[]): string {
	if (activities.length === 0) return "以对话完成护理评估";
	return activities.map((item) => item.label || item.id).join("、");
}
