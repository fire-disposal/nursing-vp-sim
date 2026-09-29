import type {
	ScenarioMessage,
	ScenarioTarget,
	ScenarioView,
} from "@/api/scenario";

/**
 * 学生侧的**投影读法**（纯函数，唯一收口处）。
 *
 * 这里只做三件事，全部由权威 `ScenarioView` 得出：
 * - 把「同一时间单位内的尝试 → 世界回应 → 可见变化」**分组**（不再按最近 N 条裁剪；
 *   一个时间单位里可以有多条消息，也可能一条都没有推进时间）；
 * - 把机器值翻成学生能读的话（阶段、消息类别、对象、行动归属）；
 * - 提交中那条**待定**学生消息的形状（权威消息到达后按稳定 `id` 接替）。
 *
 * 不再有：模型原始块（`blocks`）的前端镜像、按「时间点＋文案」猜同一件事、把未提交
 * 草稿当事实。视图缺什么就是还没有（`docs/scenario.md` §4.5、§7.5）。
 */

/** 一条待定（乐观）学生消息：学生刚提交、权威视图还没到的那一句。 */
export interface PendingStudentLine {
	requestId: string;
	kind: "speech" | "action" | "hint";
	text: string;
	/** 收信人／行动对象；`null` = 未指定。 */
	target: ScenarioTarget | null;
}

/**
 * SSE 阶段 → 学生能读的话（`docs/scenario.md` §7.6：只给**真实**阶段，不伪造进度、不做假轮播）。
 *
 * 阶段名是后端契约的封闭枚举，这里只负责翻译；出现未知阶段原样透传，不自造新阶段名。
 */
export const PHASE_LABEL: Record<string, string> = {
	receiving: "正在接受本次请求",
	resolving: "正在结算本次行动",
	delivering: "正在生成回应",
	committing: "正在提交本次结果",
};

/** 阶段文案；未知阶段原样返回（不认识就不假装认识）。 */
export function phaseText(phase: string): string {
	if (phase === "") return "正在处理本次请求";
	return PHASE_LABEL[phase] ?? phase;
}

/** 消息类别的可读标签：形状之外还有文字，不靠颜色／图标区分（`docs/scenario.md` §7.8）。 */
export function messageKindLabel(kind: ScenarioMessage["kind"]): string {
	switch (kind) {
		case "speech":
			return "对话";
		case "action":
			return "行动";
		case "narration":
			return "旁白";
		case "clarification":
			return "需要补充";
		case "hint":
			return "提示";
		case "blocked":
			return "未能执行";
		case "unmodeled":
			return "未建模";
	}
}

/**
 * 目标引用 → 可读文字。
 *
 * 名字只来自当前视图里**已经存在**的声明对象；查不到就如实显示引用本身
 * （对方离场时不该凭空编一个名字，也不该静默换成别人）。
 */
export function targetText(
	target: ScenarioTarget | null | undefined,
	view: ScenarioView | null = null,
): string {
	if (!target) return "";
	switch (target.kind) {
		case "actor": {
			const actor = view?.actors?.find((item) => item.id === target.id);
			return actor?.role || target.id;
		}
		case "device": {
			const device = view?.devices?.find((item) => item.id === target.id);
			return device?.title || target.id;
		}
		case "scene":
			return "当前场景";
		default:
			return target.id;
	}
}

/** 学生这条是**说话**还是**尝试行动**（`declaration` 与气泡形态一致）。 */
export function studentDeclarationLabel(
	message: ScenarioMessage,
): string | null {
	if (message.role !== "student") return null;
	const act = message.declaration === "act" || message.kind === "action";
	return act ? "行动" : "说话";
}

/**
 * 学生消息的完整读法，例如「对 2 床患者 · 行动」。
 *
 * 学生说过／尝试过什么必须能读出**对象**（`docs/scenario.md` §7.4）；没有对象的自由表达只给
 * 「说话／行动」，平台不替他补一个最近聊天对象。
 */
export function studentLineLabel(
	message: ScenarioMessage,
	view: ScenarioView | null = null,
): string | null {
	const declaration = studentDeclarationLabel(message);
	if (declaration === null) return null;
	const target = targetText(message.target, view);
	return target === "" ? declaration : `对 ${target} · ${declaration}`;
}

/** 一个时间单位内的全部消息（`messages[].turn` 是发生的时间单位，不是提交序号）。 */
export interface ScenarioTurnGroup {
	turn: number;
	messages: ScenarioMessage[];
}

/**
 * 按**发生的时间单位**分组消息（升序）。视图给全量消息，前端不再只取最近五条：
 * 学生向上回看时，正在读的那一段不能被裁掉（`docs/scenario.md` §7.5）。
 * 纯交流不推进时间，所以同一时间单位里出现多条消息是正常情形。
 */
export function groupTurns(
	messages: ScenarioMessage[] | undefined,
): ScenarioTurnGroup[] {
	const groups: ScenarioTurnGroup[] = [];
	for (const message of messages ?? []) {
		const last = groups[groups.length - 1];
		if (last !== undefined && last.turn === message.turn) last.messages.push(message);
		else groups.push({ turn: message.turn, messages: [message] });
	}
	return groups;
}

/**
 * 待定学生消息 → 参与渲染的正式消息形状。
 *
 * `id` 用请求身份派生（同一次尝试重连不会产生第二条），权威消息到达后由视图里的
 * 真身接管；`id` 前缀 `pending:` 让「这条还没被确认」可被识别，而不是靠文案比对。
 */
export function pendingMessage(
	line: PendingStudentLine,
	view: ScenarioView | null,
): ScenarioMessage {
	return {
		id: `pending:${line.requestId}`,
		role: "student",
		kind: line.kind === "hint" ? "hint" : line.kind,
		text: line.text,
		turn: view?.session?.turn ?? 0,
		target: line.target,
		declaration: line.kind === "action" ? "act" : "say",
		actor: null,
		actor_role: null,
		ephemeral: false,
		avatar_seed: null,
		origin: "student",
		sources: [],
	};
}

/** 权威视图是否已经接管这条待定消息（同一次尝试 → 同一条学生消息）。 */
export function isPendingPlaceholder(message: ScenarioMessage): boolean {
	return message.id.startsWith("pending:");
}

/**
 * 这个动作是否会**花情境时间**（包声明字段 `Affordance.time_cost`）。
 *
 * 时间语义：说话/观察/测量不花时间，只有声明为耗时的尝试（以及刻意等待）让时间前进。
 * 学生有权在上手前看出哪些动作要花时间——这是透明化，不是提示答案。
 * 字段目前在包的声明形状里（编辑器按原始 JSON 编辑）；学生视图投影是否带上它由后端决定，
 * 所以这里是边界读法：拿不到就按 0 处理（不标记），**不猜、不按提交次数推导**。
 */
export function timeCost(affordance: unknown): number {
	if (affordance !== null && typeof affordance === "object" && "time_cost" in affordance) {
		const value = affordance.time_cost;
		return typeof value === "number" ? value : 0;
	}
	return 0;
}

/** 回看定位：把某个时间单位滚进视野的定位 id（`sources` 里的 `event:` 不下钻到行）。 */
export function turnAnchorId(turn: number): string {
	return `sc-turn-${turn}`;
}

/** 来源引用（`event:<seq>` / `cue:<id>` / `effect:<key>` / `action:<id>`）的可读标签。 */
export function sourceLabel(source: string): string {
	const [kind, ...rest] = source.split(":");
	const name = rest.join(":");
	switch (kind) {
		case "event":
			return `事件 #${name}`;
		case "cue":
			return `线索 ${name}`;
		case "effect":
			return `变化 ${name}`;
		case "action":
			return `动作 ${name}`;
		default:
			return source;
	}
}
