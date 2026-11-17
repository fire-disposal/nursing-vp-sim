
/**
 * VoiceTurnController —— 持续（双工）对谈的**真实轮次**状态机。
 *
 * 纯逻辑、无浏览器 API、无 React：`useVoiceDialogue` 只把 ASR/VAD 事件转进来，
 * 单测直接按事件序列断言（不加载 ONNX、不开麦克风、不开 WS）。
 *
 * 一轮学生发言的生命周期：
 *   idle ──speechStart──▶ 开一轮候选（**不许打断患者**：可能是短噪声）
 *        ──speechRealStart（VAD 确认 ≥250ms 有效语音）──▶ 患者出声则 onBargeIn（每轮一次）
 *        ──speechEnd（VAD 判收尾）──▶ 进入端点等待，等 definite
 *        ──definite 非空──▶ 提交（每轮最多 onSend 一次）
 *        ──definite 为空 / final 超时──▶ 丢弃本轮（不发送）
 *        ──重新开口（speechStart）──▶ 取消端点等待，本轮内容保留
 *   misfire（<250ms 的噪声）：只撤掉本轮候选，**从不停播、从不提交**。
 *
 * 无 VAD 的降级：供应商报 `interim`（有新的中间结果）⇒ 起静音窗口，到点把当前字幕
 * 当句尾提交（旧行为原样保留）；患者出声时按文本判打断。
 *
 * 隔离：`start()`/`stop()`/`dispose()` 都换 epoch；所有异步回调（定时器、供应商迟到
 * 事件）都带着发起时的 epoch，epoch 不符直接丢弃——stop 之后到达的 definite、
 * 旧会话的 onEnd、旧 WS 的错误都不可能提交消息。
 */

/** 状态机对外暴露的阶段（与 `VoicePhase` 同一套取值，`ready`/`awaiting` 由 hook 决定）。 */
export type TurnPhase = "idle" | "listening" | "sending";

export interface VoiceTurnTarget {
	/** 唯一语义出口。 */
	onSend(text: string): void;
	/** 打断出口：患者仍在说话/回复时触发一次（停播 + 取消在途生成由调用方负责）。 */
	onBargeIn?(): void;
	onPhase?(phase: TurnPhase): void;
	onTranscript?(text: string): void;
	onInterrupted?(interrupted: boolean): void;
	onNotice?(notice: string | null): void;
	/** 学生真的开口了（每轮一次）：调用方可在此时暂停云端播放做回声抑制。 */
	onSpeechStart?(): void;
}

export interface VoiceTurnDeps {
	/** 患者是否"可被打断地出声"：回复中或 TTS 正在播。 */
	patientAudible(): boolean;
	/** VAD 判收尾后等 definite 的最长时间。 */
	finalTimeoutMs?: number;
	/** 无 VAD 时（interim 驱动）的静音窗口。 */
	endpointMs?: number;
}

/** 端点等待的上限：VAD 已判收尾却等不到 definite 时，本轮作废（防空转）。 */
export const DEFAULT_FINAL_TIMEOUT_MS = 2500;
/** interim 驱动的静音窗口兜底。 */
export const DEFAULT_ENDPOINT_MS = 1200;

interface Turn {
	/** 本句累计文本（不含已提交的历史句）。 */
	text: string;
	finalTimer?: ReturnType<typeof setTimeout>;
	endpointTimer?: ReturnType<typeof setTimeout>;
}

export class VoiceTurnController {
	private epoch = 0;
	private running = false;
	private phaseValue: TurnPhase = "idle";
	/** 当前回合：`null` = 不在学生回合内。 */
	private turn: Turn | null = null;
	/** 是否还在收这一句（endpointing 之外的新开口都算同一轮）。 */
	private barged = false;
	private sent = false;
	/** 本句是否已经收到过 definite（迟到的重复结果据此丢弃）。 */
	private settled = false;

	constructor(
		private readonly target: VoiceTurnTarget,
		private readonly deps: VoiceTurnDeps,
	) {}

	get currentEpoch(): number {
		return this.epoch;
	}

	get phase(): TurnPhase {
		return this.phaseValue;
	}

	get inTurn(): boolean {
		return this.turn !== null;
	}

	/** 开启聆听：换 epoch，清掉上一轮的一切残留。 */
	start(): number {
		this.epoch += 1;
		this.running = true;
		this.resetTurn();
		this.setPhase("listening");
		this.setTranscript("");
		this.target.onInterrupted?.(false);
		return this.epoch;
	}

	/** 停止聆听：换 epoch；`commitPending` 时把已说出的内容作为一条消息提交。 */
	stop(options: { commitPending?: boolean } = {}): void {
		const pending = this.turn?.text.trim() ?? "";
		this.epoch += 1;
		this.running = false;
		this.clearTimers();
		this.resetTurn();
		if (options.commitPending && pending) {
			this.setPhase("sending");
			this.setTranscript("");
			this.emitSend(pending);
			return;
		}
		this.setPhase("idle");
		this.setTranscript("");
		this.target.onInterrupted?.(false);
	}

	/** 彻底作废：此后任何迟到事件都进不来。 */
	dispose(): void {
		this.epoch += 1;
		this.running = false;
		this.clearTimers();
		this.resetTurn();
	}

	/** 事件闸门：epoch 不符（或已停止）的事件一律丢弃。 */
	isCurrent(eventEpoch: number): boolean {
		return this.running && eventEpoch === this.epoch;
	}

	// ── VAD 轮次事件 ──

	/** 检测到有人开口。短噪声（来不及 real start）只留一个空候选，不会打断患者。 */
	speechStart(eventEpoch = this.epoch): void {
		if (!this.isCurrent(eventEpoch)) return;
		if (this.settled) this.resetTurn();
		this.cancelEndpoint();
		if (!this.turn) this.turn = { text: "" };
		this.target.onSpeechStart?.();
	}

	/** 有效语音确认（≥250ms）：此刻才允许打断患者。 */
	speechRealStart(eventEpoch = this.epoch): void {
		if (!this.isCurrent(eventEpoch)) return;
		if (!this.turn) this.turn = { text: "" };
		if (this.barged) return;
		if (!this.deps.patientAudible()) return;
		this.barged = true;
		this.target.onInterrupted?.(true);
		try {
			this.target.onBargeIn?.();
		} catch (err) {
			console.error("[voice] 打断处理失败", err);
		}
	}

	/** VAD 判收尾：进入端点等待。`definite` 落地即提交，等不到就等 final 超时。 */
	speechEnd(eventEpoch = this.epoch): void {
		if (!this.isCurrent(eventEpoch)) return;
		if (!this.turn || this.settled) return;
		this.clearTimers();
		const timeout = this.deps.finalTimeoutMs ?? DEFAULT_FINAL_TIMEOUT_MS;
		const epoch = this.epoch;
		const timer = setTimeout(() => {
			if (!this.isCurrent(epoch)) return;
			if (this.settled) return;
			// 等不到 definite：本轮作废（标记 settled，迟到的 definite 一律丢弃），
			// 字幕清掉，学生可以重新说或直接用文字。
			this.settled = true;
			this.turn = null;
			this.clearTimers();
			this.setTranscript("");
			this.setPhase("listening");
		}, timeout);
		if (this.turn) this.turn.finalTimer = timer;
	}

	/** 短噪声（<250ms）：撤掉候选。**不**停播、**不**提交、**不**改打断状态。 */
	misfire(eventEpoch = this.epoch): void {
		if (!this.isCurrent(eventEpoch)) return;
		if (!this.turn || this.settled) return;
		// 已经有内容的轮次是真语音（模型把开头判成噪声也不会把文字带走）
		if (this.turn.text.trim()) return;
		this.clearTimers();
		this.turn = null;
		this.setTranscript("");
	}

	// ── 识别结果 ──

	/** 中间结果：只进字幕，永不提交。 */
	partial(text: string, eventEpoch = this.epoch): void {
		if (!this.isCurrent(eventEpoch)) return;
		if (this.settled) return;
		if (!this.turn) this.turn = { text: "" };
		const turn = this.turn;
		// 端点已到点但结果还在陆续到达：新内容说明还没说完，撤掉收尾计时
		if (turn.endpointTimer) this.cancelEndpoint();
		turn.text = text;
		this.setTranscript(text);
	}

	/** 句尾结果：非空才提交（每轮最多一次）；空 definite 不调用 onSend。 */
	definite(text: string, eventEpoch = this.epoch): void {
		if (!this.isCurrent(eventEpoch)) return;
		if (this.settled) return;
		// 空 definite 逐字遵守"不提交"：云 ASR 说没听清就是没听清，
		// 哪怕本地字幕里还留着中间文本（那可能只是噪声的误识别）。
		const merged = text.trim();
		if (!merged) {
			this.clearTimers();
			this.turn = null;
			this.setTranscript("");
			this.setPhase("listening");
			return;
		}
		this.submit(merged);
	}

	/**
	 * 无 VAD 的降级信号：有新的中间结果 ⇒ 重起静音窗口。
	 * 供应商只给 `interim`（Web Speech / 降级云 ASR），没有 VAD 轮次事件。
	 */
	interim(text: string, eventEpoch = this.epoch): void {
		if (!this.isCurrent(eventEpoch)) return;
		if (this.settled) return;
		if (!this.barged && text.trim() && this.deps.patientAudible()) {
			this.barged = true;
			this.target.onInterrupted?.(true);
			try {
				this.target.onBargeIn?.();
			} catch (err) {
				console.error("[voice] 打断处理失败", err);
			}
		}
		if (!this.turn) this.turn = { text: "" };
		const turn = this.turn;
		// VAD 轮次路径不给 interim；这条分支只在"没有 VAD"时走到，
		// 因此文本就是本句的最新全量内容 —— 端点窗口到点按它提交。
		turn.text = text;
		this.setTranscript(text);
		this.clearTimers();
		const endpointMs = this.deps.endpointMs ?? DEFAULT_ENDPOINT_MS;
		const epoch = this.epoch;
		turn.endpointTimer = setTimeout(() => {
			if (!this.isCurrent(epoch)) return;
			const current = this.turn?.text.trim() ?? "";
			if (!current) {
				this.turn = null;
				this.setTranscript("");
				return;
			}
			this.definite(current, epoch);
		}, endpointMs);
	}

	// ── 内部 ──

	private submit(text: string): void {
		if (this.sent) return;
		this.settled = true;
		this.clearTimers();
		this.setPhase("sending");
		this.setTranscript("");
		this.emitSend(text);
		this.sent = true;
		this.turn = null;
	}

	private resetTurn(): void {
		this.turn = null;
		this.barged = false;
		this.sent = false;
		this.settled = false;
	}

	private cancelEndpoint(): void {
		clearTimeout(this.turn?.finalTimer);
		clearTimeout(this.turn?.endpointTimer);
		if (this.turn) {
			this.turn.finalTimer = undefined;
			this.turn.endpointTimer = undefined;
		}
	}

	private clearTimers(): void {
		this.cancelEndpoint();
	}

	private emitSend(text: string): void {
		try {
			this.target.onSend(text);
		} catch (err) {
			console.error("[voice] 语音转写发送失败", err);
			this.setPhase("idle");
			this.target.onNotice?.("语音消息发送失败，请改用文字输入重试");
		}
	}

	private setPhase(phase: TurnPhase): void {
		if (this.phaseValue === phase) return;
		this.phaseValue = phase;
		this.target.onPhase?.(phase);
	}

	private setTranscript(text: string): void {
		this.target.onTranscript?.(text);
	}
}
