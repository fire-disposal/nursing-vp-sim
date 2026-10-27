import type { NavigateFunction } from "react-router-dom";

/**
 * 训练会话的进入/离开契约（唯一实现）。
 *
 * 痛点（2026-09-30 审计）：训练页是沉浸壳，没有 App 导航，唯一出口是 `navigate(-1)`，
 * 而按钮文案写死"返回训练选择"。15 个入口里只有 5 类满足这个说法，从记录页/历史页进入时
 * 文案直接说谎；直链或刷新进来时 `-1` 还可能出站。
 *
 * 规则：
 * - **进入**一律带 `state.from`（来源页 pathname+search），由 {@link goTraining} 写；
 * - **离开**读 {@link readTrainingOrigin}，有来源就回来源，没有（直链/刷新）落到记录列表——
 *   `/history` 对任何能进训练的人都可达，且列表里能重新进入刚离开的会话。
 */

export interface TrainingLocationState {
	/** 进入训练时的来源页（pathname + search）。 */
	from?: string;
}

/** 来源页对应的动作文案（用于按钮 title/aria-label，避免文案与行为不符）。 */
export function trainingOriginLabel(from: string | undefined): string {
	if (!from) return "离开训练，返回训练记录";
	if (from.startsWith("/training")) return "离开训练，返回训练选择";
	if (from.startsWith("/record")) return "离开训练，返回记录详情";
	if (from.startsWith("/history")) return "离开训练，返回训练记录";
	if (from.startsWith("/admin")) return "离开训练，返回上一页";
	if (from === "/") return "离开训练，返回首页";
	return "离开训练，返回上一页";
}

/** 读取来源；非法值（站外、空串）一律当没有。 */
export function readTrainingOrigin(state: unknown): string | undefined {
	const from = (state as TrainingLocationState | null)?.from;
	if (typeof from !== "string" || !from.startsWith("/")) return undefined;
	return from;
}

/** 离开训练页的落点 = `readTrainingOrigin(state) ?? "/history"`（来源优先，无来源落记录列表）。 */

/** 进入训练页（所有入口的唯一写法）：把当前页记进 `state.from`。 */
export function goTraining(
	navigate: NavigateFunction,
	recordId: number | string,
	from: string,
	options?: { replace?: boolean },
): void {
	navigate(`/training/${recordId}`, {
		state: { from } satisfies TrainingLocationState,
		replace: options?.replace,
	});
}

/**
 * 通知点击的落点规则（**唯一实现**：铃铛、通知中心、训练页通知预览三处共用）。
 *
 * 三处曾各写一份相同的 if-链，改口径要改三遍——口径一旦不同，同一个通知在不同入口
 * 会去不同页面（旧实现里"进行中的记录"在铃铛去只读详情、在训练页去继续练）。
 *
 * 口径：反馈回复 → 我的反馈；作业/催交 → 有进行中记录直接续练，否则作业列表；
 * 评分结果 → 该记录详情（无记录退记录列表）；其余有记录 → 记录详情。
 */
export function openNotification(
	navigate: NavigateFunction,
	notification: { type: string; record_id?: number | null },
	from: string,
): void {
	const { type, record_id } = notification;
	if (type === "feedback_replied") {
		navigate("/my-feedback");
		return;
	}
	if (type.startsWith("assignment_") || type === "reminder") {
		if (record_id) goTraining(navigate, record_id, from);
		else navigate("/training?tab=assignments");
		return;
	}
	if (type.startsWith("scoring_")) {
		navigate(record_id ? `/record/${record_id}` : "/history");
		return;
	}
	if (record_id) navigate(`/record/${record_id}`);
	else navigate("/notifications");
}
