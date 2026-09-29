import type {
	ScenarioAffordance,
	ScenarioCloseResponse,
	ScenarioMessage,
	ScenarioPackSummary,
	ScenarioReport,
	ScenarioRequestLookup,
	ScenarioSessionResponse,
	ScenarioSessionState,
	ScenarioStreamEvent,
	ScenarioTurnPhase,
	ScenarioTurnResult,
	ScenarioView,
} from "@/api/scenario";

/**
 * 情境测试的**唯一**造形状处（新契约）。
 *
 * 为什么集中：字段名一改，散在十几个用例里的字面量只会一部分跟着改，剩下的变成
 * 静默过期的假数据（旧套件就是这么坏的：`options`/`problems`/`origin: "entity"` 还在，
 * 但没有一个用例会因为契约变了而真的失败）。所有用例都从这里取，改一次就够。
 *
 * 只造**可见投影**：学生面没有 problems、没有教学关注点、没有隐藏事实。
 */

export const PACK: ScenarioPackSummary = {
	key: "sputum_ineffective",
	title: "术后低氧",
	state: "experimental",
	one_line: "术后第二天，患者呼吸费力。",
	revision_id: 7,
	revision_no: 3,
	player_role: "夜班护士",
	place: "呼吸内科病房",
};

/** 一条消息。`id` 是稳定身份（接续与去重用它，不按文案）。 */
export function makeMessage(overrides: Partial<ScenarioMessage> = {}): ScenarioMessage {
	return {
		id: "m1.0",
		role: "scene",
		kind: "narration",
		text: "监护仪在响。",
		turn: 1,
		ephemeral: false,
		origin: "dm",
		...overrides,
	};
}

/** 一个可用动作：`options` 是 `{id,label}`（`selection` 只发 id）。 */
export function makeAffordance(
	overrides: Partial<ScenarioAffordance> = {},
): ScenarioAffordance {
	return {
		id: "auscultate",
		type: "observe",
		label: "听诊双肺",
		select: "none",
		options: [],
		fields: [],
		free_input: true,
		confirm: false,
		targets: [],
		// 时间语义：0 = 瞬时（不花情境时间）；包声明为耗时的动作才 > 0
		time_cost: 0,
		...overrides,
	};
}

/** 完整学生视图。默认：3 张床都在场，第 1 回合有一段旁白 + 一句患者台词。 */
export function makeView(overrides: Partial<ScenarioView> = {}): ScenarioView {
	return {
		session: { id: 12, status: "active", turn: 1, lost: false, seq: 4, read_only: false, trial: false },
		pack: { key: PACK.key, title: PACK.title, player_role: "责任护士", revision_id: 7 },
		situation: {
			place: "外科病房",
			time_hint: "术后第 2 天 08:40",
			resources: ["负压吸引器"],
			visible_cues: ["患者呼吸费力"],
			noticed: [],
		},
		actors: [
			{ id: "patient", role: "2 床患者", presence: "on_site", present: true, contactable: true },
			{ id: "other", role: "3 床患者", presence: "on_site", present: true, contactable: true },
			{ id: "away", role: "值班医生", presence: "inaccessible", present: false, contactable: false },
		],
		hud: [{ slot: "血氧", source: "state", label: "血氧", value: 89, ref: "vitals.spo2" }],
		messages: [
			makeMessage({ id: "m1.0", role: "scene", kind: "narration", text: "监护仪在响。", turn: 1 }),
			makeMessage({
				id: "m1.1",
				role: "actor",
				kind: "speech",
				actor: "patient",
				actor_role: "2 床患者",
				avatar_seed: "patient",
				text: "我……喘不上气。",
				turn: 1,
			}),
		],
		affordances: [makeAffordance(), makeAffordance({ id: "suction", type: "act", label: "吸痰" })],
		free_input: true,
		timeline: [{ turn: 1, kind: "world", label: "监护仪在响。" }],
		dims: [],
		nudges: [],
		assets: [],
		images: [],
		board: { sections: [], entry_count: 0, editable: false },
		devices: [],
		panels: [],
		...overrides,
	};
}

export function makeTurnResult(overrides: Partial<ScenarioTurnResult> = {}): ScenarioTurnResult {
	return {
		request_id: "req-1",
		seq: 6,
		committed: true,
		turn: 2,
		// 时间语义：0 = 这次请求没有推进情境时间（说话/观察/测量都是 0）
		time_cost: 0,
		outcome: "speech",
		messages: [],
		view: makeView({ session: { id: 12, status: "active", turn: 2, lost: false, seq: 6, read_only: false, trial: false } }),
		...overrides,
	};
}

export function makeLookup(overrides: Partial<ScenarioRequestLookup> = {}): ScenarioRequestLookup {
	return { request_id: "req-1", kind: "turn", state: "committed", resend_safe: true, ...overrides };
}

export function makeSessionState(
	overrides: Partial<ScenarioSessionState> = {},
): ScenarioSessionState {
	return { session_id: 12, status: "active", view: makeView(), read_only: false, ...overrides };
}

export function makeSessionResponse(
	overrides: Partial<ScenarioSessionResponse> = {},
): ScenarioSessionResponse {
	return { session_id: 12, pack: makeView().pack, view: makeView(), ...overrides };
}

export function makeReport(overrides: Partial<ScenarioReport> = {}): ScenarioReport {
	return {
		pack: makeView().pack,
		outcome: { status: "ended_by_student", reason: "你结束了本次情境", turn: 3, lost: false },
		key_turns: [
			{
				turn: 1,
				student: "我先看看他的呼吸。",
				evidence: ["指脉氧 89%"],
				changes: ["患者呼吸仍然费力"],
			},
		],
		reflection: "当时还有哪条线索没有核查？",
		assessment: {
			summary: { strong: 1, adequate: 0, missed: 1 },
			score: { rate: 0.5, weighted_sum: 50, total_weight: 100, criteria: [] },
			criteria: [],
			dims: [],
		},
		timeline: [{ turn: 1, kind: "world", label: "监护仪在响。" }],
		...overrides,
	};
}

export function makeCloseResponse(
	overrides: Partial<ScenarioCloseResponse> = {},
): ScenarioCloseResponse {
	return {
		session_id: 12,
		report: makeReport(),
		view: makeView({
			session: { id: 12, status: "completed", turn: 3, lost: false, seq: 9, read_only: true, trial: false },
		}),
		...overrides,
	};
}

/* ── SSE 事件（`event:` 名 → 前端判别键 `kind`） ── */

export function ssePhase(phase: ScenarioTurnPhase): ScenarioStreamEvent {
	return { kind: "phase", request_id: "req-1", phase };
}

export function sseDelivery(): ScenarioStreamEvent {
	return {
		kind: "delivery",
		request_id: "req-1",
		pending: true,
		delivery: { messages: [{ text: "未提交草稿里的话", actor: null }] },
	} as unknown as ScenarioStreamEvent;
}

export function sseCommitted(result: ScenarioTurnResult): ScenarioStreamEvent {
	return { kind: "committed", request_id: result.request_id, seq: result.seq, result };
}

export function sseError(code: string, message: string): ScenarioStreamEvent {
	return {
		kind: "error",
		request_id: "req-1",
		phase: "delivering",
		error: { code, message, retryable: true },
	};
}
