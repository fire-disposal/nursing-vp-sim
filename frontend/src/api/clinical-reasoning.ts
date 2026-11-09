import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";
import { postToolCommand, type ToolCommandResult } from "./training";

/**
 * 临床判断训练（`workflow.id === "clinical_reasoning"`）的客户端通道。
 *
 * 两条路，各有唯一 owner：
 *
 * - **状态**（场景 / 已确认证据 / 可执行动作 / 目标进度）—— 工具指令面
 *   `clinical_judgment.load|observe|act`。服务端是唯一裁判：前端从不自己推演
 *   "某条证据是否该出现"，也不从病例原文里补答案。
 * - **对话** —— 非流式 `POST /chat/{id}/message`（本工作区是独立 LLM 核心，
 *   没有 SSE 通道，也不需要语音/情绪投影）。
 *
 * 载荷形状不在生成的 openapi 类型里（后端这一面按契约先于代码固化），因此这里做
 * **显式窄化**：只接受契约声明的字段与闭集取值，其余一律丢弃 —— 服务端多加字段不会
 * 让界面崩，字段缺失则表现为"这条不显示"，而不是 `undefined.map`。
 */

// ── 状态契约（与服务端 `clinical_judgment.load` 返回的 `data.state` 同形） ──

/** 证据获取途径的分类（契约闭集；未知值降级为 `observation`）。 */
export type ClinicalEvidenceKind = "vital_sign" | "exam" | "lab" | "history" | "observation";

/** 已确认证据：学生**已经拿到**的一条事实。 */
export interface ClinicalEvidence {
	finding_id: string;
	label: string;
	kind: ClinicalEvidenceKind;
	note: string;
	/** 这条证据从哪来（患者回答 / 床旁检查 / 检验单 …），由服务端给出，可空。 */
	source: string;
	/** 产出这条证据的对话消息 id —— 有才能做"证据 ↔ 对话"定位。 */
	message_id?: number;
}

/** 现在还**可以获取**的证据入口（`available_findings`）。 */
export interface ClinicalAvailableFinding {
	finding_id: string;
	/** 获取动作（"床旁听诊" / "查看检验单" …），服务端文案。 */
	action: string;
	label: string;
}

export interface ClinicalMustActObjective {
	id: string;
	label: string;
	/** 学生要做的关键动作，服务端文案。 */
	action: string;
	completed: boolean;
	/**
	 * 前置证据是否齐备 —— 服务端判定，前端**不**自己推演。
	 *
	 * 缺省 `true`：旧服务端不发这个字段时，行动照旧可点（`act` 仍由服务端兜底拒绝）。
	 */
	available: boolean;
	/** 还缺哪几条前置证据（服务端 `findings[].label`），`available === false` 时非空。 */
	missing_findings: string[];
}

export interface ClinicalMustCommunicateObjective {
	id: string;
	label: string;
	completed: boolean;
}

export interface ClinicalObjectives {
	notice_count: number;
	notice_total: number;
	must_act: ClinicalMustActObjective[];
	must_communicate: ClinicalMustCommunicateObjective[];
}

export interface ClinicalScenario {
	title: string;
	/** 患者 / 环境（"外科病房 3 床"）。 */
	setting: string;
	summary: string;
	/** 给学生看的任务简报（可空）。 */
	learner_brief: string;
}

export interface ClinicalJudgmentState {
	scenario: ClinicalScenario;
	evidence: ClinicalEvidence[];
	available_findings: ClinicalAvailableFinding[];
	objectives: ClinicalObjectives;
	/** 乐观并发版本：每次成功指令后前移，下一次指令带上它。 */
	revision: number;
}

// ── 窄化工具 ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function bool(value: unknown): boolean {
	return value === true;
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

const EVIDENCE_KINDS: readonly ClinicalEvidenceKind[] = [
	"vital_sign",
	"exam",
	"lab",
	"history",
	"observation",
];

function evidenceKind(value: unknown): ClinicalEvidenceKind {
	return EVIDENCE_KINDS.includes(value as ClinicalEvidenceKind)
		? (value as ClinicalEvidenceKind)
		: "observation";
}

const EMPTY_OBJECTIVES: ClinicalObjectives = {
	notice_count: 0,
	notice_total: 0,
	must_act: [],
	must_communicate: [],
};

/**
 * `data.state` → `ClinicalJudgmentState`。
 *
 * 非对象 / 缺 `scenario` 的状态视为**异常载荷**，返回 `null`：调用方据此显示
 * "状态不可用"并允许重试，而不是渲染一个看起来正常、实则清空了的空工作台
 * （后者会让学生以为证据丢了）。
 */
export function parseClinicalJudgmentState(raw: unknown): ClinicalJudgmentState | null {
	const root = asRecord(raw);
	if (!root) return null;
	const scenarioRaw = asRecord(root.scenario);
	if (!scenarioRaw) return null;

	const objectivesRaw = asRecord(root.objectives);

	const evidence = list(root.evidence)
		.map((item): ClinicalEvidence | null => {
			const record = asRecord(item);
			const findingId = text(record?.finding_id).trim();
			if (!record || !findingId) return null;
			const messageId = record.message_id;
			const parsed: ClinicalEvidence = {
				finding_id: findingId,
				label: text(record.label, findingId),
				kind: evidenceKind(record.kind),
				note: text(record.note),
				source: text(record.source),
			};
			if (typeof messageId === "number" && Number.isFinite(messageId)) parsed.message_id = messageId;
			return parsed;
		})
		.filter((item): item is ClinicalEvidence => item !== null);

	const availableFindings = list(root.available_findings)
		.map((item): ClinicalAvailableFinding | null => {
			const record = asRecord(item);
			const findingId = text(record?.finding_id).trim();
			if (!record || !findingId) return null;
			return {
				finding_id: findingId,
				action: text(record.action),
				label: text(record.label, findingId),
			};
		})
		.filter((item): item is ClinicalAvailableFinding => item !== null);

	return {
		scenario: {
			title: text(scenarioRaw.title),
			setting: text(scenarioRaw.setting),
			summary: text(scenarioRaw.summary),
			learner_brief: text(scenarioRaw.learner_brief),
		},
		evidence,
		available_findings: availableFindings,
		objectives: objectivesRaw
			? {
					notice_count: count(objectivesRaw.notice_count),
					notice_total: count(objectivesRaw.notice_total),
					must_act: list(objectivesRaw.must_act)
						.map((item): ClinicalMustActObjective | null => {
							const record = asRecord(item);
							const id = text(record?.id).trim();
							if (!record || !id) return null;
							return {
								id,
								label: text(record.label, id),
								action: text(record.action),
								completed: bool(record.completed),
								// 缺省兼容：没有 `available` 字段 = 服务端没做前置判定，行动可点。
								available: record.available === undefined ? true : bool(record.available),
								missing_findings: list(record.missing_findings)
									.map((entry) => text(entry).trim())
									.filter((entry) => entry !== ""),
							};
						})
						.filter((item): item is ClinicalMustActObjective => item !== null),
					must_communicate: list(objectivesRaw.must_communicate)
						.map((item): ClinicalMustCommunicateObjective | null => {
							const record = asRecord(item);
							const id = text(record?.id).trim();
							if (!record || !id) return null;
							return { id, label: text(record.label, id), completed: bool(record.completed) };
						})
						.filter((item): item is ClinicalMustCommunicateObjective => item !== null),
				}
			: EMPTY_OBJECTIVES,
		revision: count(root.revision),
	};
}

// ── 指令 ──────────────────────────────────────────────────────────────

/** 指令名（`cmd`）—— 三个都是 `clinical_judgment` 命名空间下的动作。 */
export const CLINICAL_JUDGMENT_CMD = {
	load: "clinical_judgment.load",
	observe: "clinical_judgment.observe",
	act: "clinical_judgment.act",
} as const;

export type ClinicalJudgmentCmd = (typeof CLINICAL_JUDGMENT_CMD)[keyof typeof CLINICAL_JUDGMENT_CMD];

export interface ClinicalJudgmentCall {
	/** 服务端原始响应（保留 `ok` / `error` / `revision` 供调用方归因）。 */
	response: ToolCommandResult;
	/** 窄化后的状态；载荷不可用时为 `null`。 */
	state: ClinicalJudgmentState | null;
}

/**
 * 调一次 `clinical_judgment.*`。
 *
 * 幂等键由调用方生成并在重试时复用（同一次点击 = 同一个 key）；`revision` 同理 ——
 * 409 冲突由调用方用响应里的 `current_revision` 更新后，**带同一个 `idem_key`** 重试，
 * 服务端才能把它认成"同一次动作"。
 */
export async function callClinicalJudgment(
	recordId: number | string,
	cmd: ClinicalJudgmentCmd,
	params: Record<string, unknown>,
	idemKey: string,
	revision: number | null,
): Promise<ClinicalJudgmentCall> {
	const response = await postToolCommand(recordId, {
		cmd,
		params,
		idem_key: idemKey,
		revision,
	});
	const stateRaw = asRecord(response.data)?.state;
	return { response, state: parseClinicalJudgmentState(stateRaw) };
}

/** 首次进入 / 每次对话或动作之后重读状态（`params: {}`）。 */
export const loadClinicalJudgment = (
	recordId: number | string,
	idemKey: string,
): Promise<ClinicalJudgmentCall> =>
	callClinicalJudgment(recordId, CLINICAL_JUDGMENT_CMD.load, {}, idemKey, null);

/** 获取一条证据（`available_findings` 里的入口）。 */
export const observeClinicalFinding = (
	recordId: number | string,
	findingId: string,
	idemKey: string,
	revision: number | null,
): Promise<ClinicalJudgmentCall> =>
	callClinicalJudgment(
		recordId,
		CLINICAL_JUDGMENT_CMD.observe,
		{ finding_id: findingId },
		idemKey,
		revision,
	);

/** 执行一项关键行动（`must_act` 目标）。 */
export const actClinicalObjective = (
	recordId: number | string,
	objectiveId: string,
	idemKey: string,
	revision: number | null,
): Promise<ClinicalJudgmentCall> =>
	callClinicalJudgment(
		recordId,
		CLINICAL_JUDGMENT_CMD.act,
		{ objective_id: objectiveId },
		idemKey,
		revision,
	);

// ── 对话（非流式） ────────────────────────────────────────────────────

type ChatMessageResponse = components["schemas"]["ChatMessageResponse"];

export interface ClinicalChatReply {
	role: string;
	content: string;
	operation?: Record<string, unknown> | null;
}

/**
 * 发一条学生消息，等待患者回复。
 *
 * `requestId` 是**这一轮**的幂等键，何时复用由调用方按结果归因决定 —— 这条边界不能想当然：
 *
 * - **结果未知**（网络中断 / 超时 / 无 HTTP 响应）：服务器可能已经收到并落库，复用原值
 *   可以让服务端回放已持久化的那一轮（`operation.replayed = true`），而不是再打一次模型；
 * - **明确的失败回合**：服务端返回 `503` + `detail: {code, message, request_id, status:"failed"}`，
 *   这一轮**已经落库为失败回合**。durable turn **不重掷**失败回合，同 request_id 重放会永久
 *   `409`；此时"重试"是新的一轮，必须换新的 `request_id`（见 `useClinicalReasoning.retrySend`）。
 */
export async function sendClinicalMessage(
	recordId: number | string,
	content: string,
	requestId: string,
	signal?: AbortSignal,
): Promise<ClinicalChatReply> {
	const res = await api.post<ChatMessageResponse>(
		`/chat/${recordId}/message` as ApiPath,
		{ content, request_id: requestId },
		{ signal },
	);
	return {
		role: res.data.role,
		content: res.data.content,
		operation: res.data.operation ?? null,
	};
}
