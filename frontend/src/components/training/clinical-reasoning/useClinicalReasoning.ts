import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	callClinicalJudgment,
	CLINICAL_JUDGMENT_CMD,
	loadClinicalJudgment,
	sendClinicalMessage,
	type ClinicalChatReply,
	type ClinicalJudgmentCmd,
	type ClinicalJudgmentState,
} from "@/api/clinical-reasoning";
import { getApiErrorMessage } from "@/utils/error";

/**
 * 服务端对"这一轮 LLM/持久化失败"的明确答复：
 *
 * ```
 * HTTP 503  detail: { code, message, request_id, status: "failed" }
 * ```
 *
 * 它和"结果未知"是两件必须分开的事：前者这一轮**已经落库为失败回合**（durable turn 不重掷
 * 失败回合，同 request_id 重放必然 409），后者服务器可能根本没收到，只有后者能复用原 key。
 */
interface FailedTurnInfo {
	code: string;
	message: string;
	requestId: string | null;
}

function readFailedTurn(error: unknown): FailedTurnInfo | null {
	if (typeof error !== "object" || error === null) return null;
	if (!("response" in error)) return null;
	const response = error.response;
	if (typeof response !== "object" || response === null) return null;
	if (!("status" in response) || response.status !== 503) return null;
	if (!("data" in response)) return null;
	const data = response.data;
	if (typeof data !== "object" || data === null || !("detail" in data)) return null;
	const detail = data.detail;
	if (typeof detail !== "object" || detail === null) return null;
	if (!("status" in detail) || detail.status !== "failed") return null;
	return {
		code: "code" in detail && typeof detail.code === "string" ? detail.code : "turn_failed",
		message: "message" in detail && typeof detail.message === "string" ? detail.message : "",
		requestId:
			"request_id" in detail && typeof detail.request_id === "string" ? detail.request_id : null,
	};
}

/** 一轮消息是否还能安全地复用原 request_id：只有"结果未知"可以。 */
function isUnknownOutcome(error: unknown): boolean {
	// 有明确的 HTTP 响应 = 服务器明确拒绝/失败，不是"不知道有没有到"。
	if (typeof error === "object" && error !== null && "response" in error) {
		const response = error.response;
		if (typeof response === "object" && response !== null) return false;
	}
	return true;
}

/** 本轮本端产生、记录详情里还没有的消息（发送中 / 刚回来）。 */
export interface ClinicalOutboxEntry {
	/** 本地稳定 id（不是服务端消息 id；两侧不会重合，因为本地从负数起算）。 */
	id: number;
	role: "student" | "patient";
	content: string;
	sending: boolean;
}

export interface ClinicalSendError {
	message: string;
	content: string;
	/** 失败那一轮用的 request_id。**只有**"结果未知"时才该复用它重试。 */
	requestId: string;
	/**
	 * 重试语义，决定下一次重试用哪个 request_id：
	 * - `unknown`（网络中断/超时/无响应）：服务器可能已经收到并落库 —— 复用原 key，
	 *   持久化的那一轮会被回放，不会绕过预算再打一次模型；
	 * - `rejected`（服务端明确回了 503 `status:"failed"`）：这一轮已经落库为失败回合，
	 *   同 key 重放只会永远 409（durable turn 不重掷失败回合）。重试即**新回合**，换新 key。
	 */
	retryMode: "unknown" | "rejected";
	/** 服务端给这次的 request_id（503 载荷里有）：用于展示/归因，不用于重试。 */
	serverRequestId?: string;
}

export interface ClinicalActionError {
	message: string;
	kind: "observe" | "act";
	/** observe 的 finding id / act 的 objective id。 */
	target: string;
	/** 复用即"同一次动作"，服务端不会记成两次。 */
	idemKey: string;
}

export interface PendingAction {
	kind: "observe" | "act";
	target: string;
}

export interface ClinicalReasoningController {
	state: ClinicalJudgmentState | null;
	loading: boolean;
	/** 首次加载失败：整个工作台没有可信状态。 */
	loadError: string | null;
	/** 后台刷新失败：旧状态仍可用，只在状态栏提示。 */
	refreshError: string | null;
	reload: () => Promise<void>;

	outbox: ClinicalOutboxEntry[];
	sending: boolean;
	sendError: ClinicalSendError | null;
	send: (content: string) => Promise<void>;
	retrySend: () => Promise<void>;

	pendingAction: PendingAction | null;
	actionError: ClinicalActionError | null;
	observe: (findingId: string) => Promise<void>;
	act: (objectiveId: string) => Promise<void>;
	retryAction: () => Promise<void>;
	dismissActionError: () => void;
}

function newIdemKey(): string {
	return crypto.randomUUID();
}

/**
 * 409 = 版本落后：服务端带回 `current_revision`（`HTTPException.detail` 的对象体）。
 * 这里窄化一个不可信的外部形状，读不到就当没有 —— 不是冲突就按普通失败处理。
 */
function conflictRevisionOf(error: unknown): number | null {
	if (typeof error !== "object" || error === null) return null;
	const response = "response" in error ? error.response : undefined;
	if (typeof response !== "object" || response === null) return null;
	if (!("status" in response) || response.status !== 409) return null;
	if (!("data" in response)) return null;
	const data = response.data;
	if (typeof data !== "object" || data === null || !("detail" in data)) return null;
	const detail = data.detail;
	if (typeof detail !== "object" || detail === null || !("current_revision" in detail)) return null;
	return typeof detail.current_revision === "number" ? detail.current_revision : null;
}

/**
 * 临床判断工作台的状态机 —— 本场景**唯一**的状态 owner。
 *
 * 三条铁律（与后端契约一一对应）：
 *
 * 1. **状态只读服务端**。证据、可获取入口、目标进度都来自 `clinical_judgment.load` 的
 *    `data.state`；前端不推演"点了一个动作应该解锁什么"，也不补隐藏答案。
 * 2. **重试复用幂等键**。同一次点击（一条消息 / 一次观察 / 一次行动）在成功前始终带同一个
 *    key：网络重试与 409 版本冲突重试都走它，服务端才不会把一次动作记成两次。
 * 3. **动作串行、对话独立**。观察/行动走一条队列（revision 因此严格递增）；对话可独立发送，
 *    但发送期间禁用输入，避免同一句话发两遍。
 *
 * 每次成功之后**静默重读**一次记录详情（`onRecordChanged`）：消息 id、状态与评分前置条件
 * 都以服务端为准，本端不自行拼装权威数据。
 */
export function useClinicalReasoning(
	recordId: string,
	onRecordChanged?: () => void,
): ClinicalReasoningController {
	// revision 是跨动作共享的乐观并发游标：用 ref，队列里读到的总是最新值。
	const revisionRef = useRef<number | null>(null);
	const queueRef = useRef<Promise<void>>(Promise.resolve());
	const disposedRef = useRef(false);

	const [state, setState] = useState<ClinicalJudgmentState | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [refreshError, setRefreshError] = useState<string | null>(null);

	const [outbox, setOutbox] = useState<ClinicalOutboxEntry[]>([]);
	/** 本地气泡的递减 id：从 -1 起，与服务端正数 id 永不冲突。 */
	const outboxSeq = useRef(-1);
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState<ClinicalSendError | null>(null);
	/** 失败那句话的本地气泡（重试时把它标回"发送中"，而不是再插一条新气泡）。 */
	const failedOutboxIdRef = useRef<number | null>(null);

	const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
	const [actionError, setActionError] = useState<ClinicalActionError | null>(null);

	useEffect(() => {
		disposedRef.current = false;
		return () => {
			disposedRef.current = true;
		};
	}, []);

	// ── 读状态 ────────────────────────────────────────────────────────

	const load = useCallback(
		async (mode: "initial" | "refresh"): Promise<void> => {
			if (mode === "initial") setLoading(true);
			try {
				// load 是读操作：幂等键只为去重本次刷新，`revision: null` 是契约允许的首次调用。
				const call = await loadClinicalJudgment(recordId, newIdemKey());
				if (!call.response.ok) throw new Error(call.response.error || "无法读取训练状态");
				if (!call.state) throw new Error("服务端返回的训练状态不完整");
				if (disposedRef.current) return;
				revisionRef.current = call.state.revision;
				setState(call.state);
				setLoadError(null);
				setRefreshError(null);
			} catch (err) {
				if (disposedRef.current) return;
				const message = getApiErrorMessage(err, "无法读取训练状态");
				if (mode === "initial") setLoadError(message);
				else setRefreshError(message);
			} finally {
				if (!disposedRef.current && mode === "initial") setLoading(false);
			}
		},
		[recordId],
	);

	useEffect(() => {
		void load("initial");
	}, [load]);

	// 学生显式点"重试"永远走 initial：它决定了工作台有没有可信状态，
	// 失败时必须是可见错误 + 重试按钮，而不是角落里的一行提示。
	const reload = useCallback(async () => {
		await load("initial");
	}, [load]);

	// ── 对话（非流式） ────────────────────────────────────────────────

	/**
	 * 真正发出一次请求。`localId` 非空表示补发**本端尚未落库**的同一个气泡（结果未知时的重试）；
	 * 传 `null` 表示这是新的一轮（首次发送，或失败回合的重新生成），要新增学生气泡。
	 */
	const dispatchSend = useCallback(
		async (content: string, requestId: string, localId: number | null): Promise<boolean> => {
			setSending(true);
			setSendError(null);
			let studentId = localId;
			if (studentId === null) {
				studentId = outboxSeq.current;
				outboxSeq.current -= 1;
				const createdId = studentId;
				setOutbox((prev) => [
					...prev,
					{ id: createdId, role: "student", content, sending: true },
				]);
			} else {
				const resentId = studentId;
				setOutbox((prev) =>
					prev.map((entry) => (entry.id === resentId ? { ...entry, sending: true } : entry)),
				);
			}
			const settledId = studentId;
			try {
				const reply: ClinicalChatReply = await sendClinicalMessage(recordId, content, requestId);
				if (disposedRef.current) return false;
				const replyId = outboxSeq.current;
				outboxSeq.current -= 1;
				setOutbox((prev) => [
					...prev.map((entry) =>
						entry.id === settledId ? { ...entry, sending: false } : entry,
					),
					{ id: replyId, role: "patient", content: reply.content, sending: false },
				]);
				onRecordChanged?.();
				return true;
			} catch (err) {
				if (!disposedRef.current) {
					setOutbox((prev) =>
						prev.map((entry) =>
							entry.id === settledId ? { ...entry, sending: false } : entry,
						),
					);
					failedOutboxIdRef.current = settledId;
					const failedTurn = readFailedTurn(err);
					const unknown = failedTurn === null && isUnknownOutcome(err);
					// 明确失败的回合已经落库；这句学生消息归它所有 —— 重试是**新回合**，
					// 已落库的那条不能再当作"本端尚未落库的气泡"再插一次。
					if (failedTurn !== null) failedOutboxIdRef.current = null;
					setSendError({
						message: failedTurn
							? "患者的这一轮回复生成失败（内容已保存为失败回合）。重试会作为新的一轮重新生成。"
							: getApiErrorMessage(err, "消息没能送达，请重试"),
						content,
						requestId,
						retryMode: unknown ? "unknown" : "rejected",
						serverRequestId: failedTurn?.requestId ?? undefined,
					});
				}
				return false;
			} finally {
				if (!disposedRef.current) setSending(false);
			}
		},
		[onRecordChanged, recordId],
	);

	const send = useCallback(
		async (content: string): Promise<void> => {
			const trimmed = content.trim();
			if (!trimmed || sending) return;
			const ok = await dispatchSend(trimmed, newIdemKey(), null);
			if (ok) void load("refresh");
		},
		[dispatchSend, load, sending],
	);

	const retrySend = useCallback(async (): Promise<void> => {
		if (!sendError || sending) return;
		// 两种重试是两件事，不能混：
		// - unknown：服务器可能已收到 → 复用原 request_id（持久化回合被回放，不重复消耗预算）；
		// - rejected：服务端已把这一轮落库为失败回合，durable turn **不重掷**，同 key 只会永久 409
		//   → 生成新 request_id，作为新的一轮重新生成。
		const requestId = sendError.retryMode === "unknown" ? sendError.requestId : newIdemKey();
		const localId = sendError.retryMode === "unknown" ? failedOutboxIdRef.current : null;
		const ok = await dispatchSend(sendError.content, requestId, localId);
		if (ok) void load("refresh");
	}, [dispatchSend, load, sendError, sending]);

	// ── 观察 / 行动 ──────────────────────────────────────────────────

	const submit = useCallback(
		async (kind: "observe" | "act", target: string, idemKey: string): Promise<void> => {
			const cmd: ClinicalJudgmentCmd =
				kind === "observe" ? CLINICAL_JUDGMENT_CMD.observe : CLINICAL_JUDGMENT_CMD.act;
			const params = kind === "observe" ? { finding_id: target } : { objective_id: target };
			let revision = revisionRef.current;
			// 两次尝试都是"同一次动作"：幂等键不变，只有 revision 会随 409 前移。
			for (let attempt = 0; attempt < 2; attempt += 1) {
				try {
					const call = await callClinicalJudgment(recordId, cmd, params, idemKey, revision);
					revisionRef.current = call.response.revision;
					if (!call.response.ok) {
						throw new Error(call.response.error || "服务端拒绝了这次操作，请重试");
					}
					if (!call.state) throw new Error("服务端返回的状态不完整，请重试");
					if (disposedRef.current) return;
					setState(call.state);
					setActionError(null);
					setRefreshError(null);
					onRecordChanged?.();
					return;
				} catch (err) {
					const current = conflictRevisionOf(err);
					if (current !== null) revisionRef.current = current;
					if (current === null || attempt === 1) {
						if (disposedRef.current) return;
						setActionError({
							message: getApiErrorMessage(err, "操作失败，请重试"),
							kind,
							target,
							idemKey,
						});
						return;
					}
					revision = current;
				}
			}
		},
		[onRecordChanged, recordId],
	);

	/** 入队：一次只跑一个动作，revision 因此严格递增。 */
	const enqueue = useCallback(
		(kind: "observe" | "act", target: string, idemKey: string): Promise<void> => {
			setPendingAction({ kind, target });
			setActionError(null);
			const run = () =>
				submit(kind, target, idemKey).finally(() => {
					if (!disposedRef.current) setPendingAction(null);
				});
			const task = queueRef.current.then(run, run);
			queueRef.current = task.catch(() => {});
			return task;
		},
		[submit],
	);

	const observe = useCallback(
		async (findingId: string): Promise<void> => {
			if (pendingAction) return;
			await enqueue("observe", findingId, newIdemKey());
		},
		[enqueue, pendingAction],
	);

	const act = useCallback(
		async (objectiveId: string): Promise<void> => {
			if (pendingAction) return;
			await enqueue("act", objectiveId, newIdemKey());
		},
		[enqueue, pendingAction],
	);

	const retryAction = useCallback(async (): Promise<void> => {
		if (!actionError || pendingAction) return;
		const { kind, target, idemKey } = actionError;
		await enqueue(kind, target, idemKey);
	}, [actionError, enqueue, pendingAction]);

	const dismissActionError = useCallback(() => setActionError(null), []);

	return useMemo(
		() => ({
			state,
			loading,
			loadError,
			refreshError,
			reload,
			outbox,
			sending,
			sendError,
			send,
			retrySend,
			pendingAction,
			actionError,
			observe,
			act,
			retryAction,
			dismissActionError,
		}),
		[
			act,
			actionError,
			dismissActionError,
			loadError,
			loading,
			observe,
			outbox,
			pendingAction,
			refreshError,
			reload,
			retryAction,
			send,
			sendError,
			sending,
			retrySend,
			state,
		],
	);
}
