import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultAsrProvider, type AsrProvider, type AsrSession } from "@/engine/asr";

/**
 * useVoiceDialogue — 语音对答状态机。两种模式共用同一个状态机出口：
 *
 * 1. **按住说话（半双工，降级路径）**：点/按住说话 → 实时转写字幕 → 说完自动发送 →
 *    患者回复 → 自动重新就绪。`silenceMs` 为说完静音窗口（0 = 仅依赖识别 onend）。
 * 2. **持续对谈（双工）**：`continuous: true` —— 一次开启即常开聆听
 *    （`continuous=true` + `interimResults=true`），静音 `silenceMs` 判句尾自动提交，
 *    提交后继续听下一句，学生不必按住。患者还在说话/回复时学生开口 → `onBargeIn()`
 *    （停播 + 取消在途生成由调用方负责），本句照常转写并在句尾送出。
 *
 * 后端零改动：最终仍是 `onSend(text)` 走现有 SSE 聊天管道 + 现有 Volc TTS 输出。
 *
 * 契约：
 *   `onSend(text)`        —— 唯一语义出口（与文本输入共用）
 *   `onBargeIn()`         —— 打断出口：学生开口而患者仍在说话/回复时触发一次；调用方负责止血
 *   `patientReplying`     —— 训练 store 的 `sending`（患者是否正在回复/说话）
 *   `silenceMs`           —— 静音窗口：到点判句尾并自动提交
 *   `asrProvider`         —— 依赖注入 ASR 供应商，默认 `defaultAsrProvider`（Web Speech）
 *   `continuous`          —— 持续对谈；启动失败（权限被拒等）时置 `continuousFailed`，调用方降级按住说话
 *
 * 状态机：
 *   idle ──start──▶ listening ──说完/松开──▶ sending ──▶ awaiting(患者回复中)
 *   awaiting ──patientReplying=false──▶ ready（"该你说话了"）──start──▶ listening
 *   任意态遇到不支持/错误 → idle + notice。
 *   持续模式：listening 常驻（不因患者回复而关闭），句尾提交后仍回 listening。
 */

export type VoicePhase = "idle" | "listening" | "sending" | "awaiting" | "ready";

/** 持续模式未给 `silenceMs` 时的端点窗口兜底：静音多久算一句说完。 */
const DEFAULT_ENDPOINT_MS = 1200;
/** 持续会话开启后立刻结束 → 计为一次"被浏览器打断"，连续多次即认定持续模式不可用。 */
const RAPID_END_MS = 500;
const RAPID_END_LIMIT = 3;
/** 重复开启持续会话前的退避（浏览器收起会话是常态，不是错误）。 */
const RESTART_BACKOFF_MS = 250;
/** 权限/设备类致命错误：持续模式不可用，必须降级按住说话（其余错误按可重试处理）。 */
const FATAL_ASR_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);

export interface UseVoiceDialogueOptions {
	/** 唯一语义出口：文本 / 转写 / 通话最终都落到这一条学生消息。 */
	onSend: (text: string) => void;
	/** 患者是否正在回复（= 训练 store 的 `sending`）。true 禁用输入，false 自动重新就绪。 */
	patientReplying: boolean;
	/**
	 * 患者是否正在**出声**（TTS 播放中，= 总线 `tts:start`→`tts:end` 之间）。
	 * 回复结束后 TTS 仍在播完最后几句：这段时间学生开口同样是打断。
	 */
	patientSpeaking?: boolean;
	/** 静音窗口（ms）：到点判句尾自动提交；0 = 按住模式仅依赖识别自然结束（onend）。 */
	silenceMs?: number;
	/** 识别语言，默认 zh-CN。 */
	lang?: string;
	/** 患者在回复结束后是否自动重新开始聆听（默认 false；按住模式用，持续模式本来就常开）。 */
	autoRearm?: boolean;
	/** ASR 供应商（依赖注入）。默认 `defaultAsrProvider`（Web Speech）。 */
	asrProvider?: AsrProvider;
	/**
	 * 持续对谈：常开聆听 + 静音判句尾 + 患者说话时开口即打断。
	 * 启动失败（麦克风权限被拒 / 浏览器限制）→ `continuousFailed=true`，由调用方降级为按住说话。
	 */
	continuous?: boolean;
	/** 打断出口：学生开始说话而患者仍在说话/回复时触发**一次**（停播 + 取消在途生成由调用方负责）。 */
	onBargeIn?: () => void;
}

export interface UseVoiceDialogueResult {
	phase: VoicePhase;
	/** 实时转写字幕（持续模式下只含**本句**未提交的部分）。 */
	transcript: string;
	/** 当前运行时是否支持语音输入。 */
	supported: boolean;
	/** 错误/提示文案（没听清、不支持、启动失败等）。 */
	notice: string | null;
	/** 持续对谈是否已开启（麦克风常开）。 */
	continuousArmed: boolean;
	/** 持续对谈启动失败 → 调用方应降级为按住说话，并把原因呈现给学生。 */
	continuousFailed: boolean;
	/** 本次学生发言是以打断患者开始的（用于输入区的可见反馈）。 */
	interrupted: boolean;
	/** 开启聆听（持续模式=打开常开麦克风；按住模式=开始一次识别）。 */
	start: () => void;
	/** 停止聆听（持续模式=关闭常开麦克风；按住模式=立即收尾发送）。 */
	stop: () => void;
	/** 按住说话：按下开始聆听。 */
	pressStart: () => void;
	/** 按住说话：松开即自动发送。 */
	pressEnd: () => void;
	reset: () => void;
}

export function useVoiceDialogue({
	onSend,
	patientReplying,
	patientSpeaking = false,
	silenceMs = 0,
	lang = "zh-CN",
	autoRearm = false,
	asrProvider = defaultAsrProvider,
	continuous = false,
	onBargeIn,
}: UseVoiceDialogueOptions): UseVoiceDialogueResult {
	const [phase, setPhase] = useState<VoicePhase>("idle");
	const [transcript, setTranscript] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const [continuousArmed, setContinuousArmed] = useState(false);
	const [continuousFailed, setContinuousFailed] = useState(false);
	const [interrupted, setInterrupted] = useState(false);

	// 供应商能力可能在运行时不变（浏览器特性稳定），一次性探测。
	// 探测本身也可能抛（浏览器/实现异常）——降级为「不支持」，不让它掀翻整个输入区。
	const supported = useMemo(() => {
		try {
			return asrProvider.supported();
		} catch (err) {
			console.warn("[useVoiceDialogue] ASR 能力探测失败，按不支持处理", err);
			return false;
		}
	}, [asrProvider]);

	const sessionRef = useRef<AsrSession | null>(null);
	const listeningRef = useRef(false);
	/** 待提交（尚未发送）的转写。 */
	const transcriptRef = useRef("");
	const finalizedRef = useRef(false);
	const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const restartTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const wasReplyingRef = useRef(patientReplying);
	/** 持续模式：麦克风是否应该保持开启（浏览器收起会话后据此重开）。 */
	const wantListenRef = useRef(false);
	const continuousFailedRef = useRef(false);
	/** 本次发言是否已经触发过打断（每次发言只触发一次）。 */
	const bargeInRef = useRef(false);
	/** 供应商累计转写与已提交位移：供应商的累计是单调增长的，本句 = 累计 − 已提交。 */
	const rawRef = useRef("");
	const consumedRef = useRef(0);
	const rapidEndRef = useRef(0);

	// 保持最新引用，避免重建识别会话。
	const onSendRef = useRef(onSend);
	onSendRef.current = onSend;
	const onBargeInRef = useRef(onBargeIn);
	onBargeInRef.current = onBargeIn;
	const patientReplyingRef = useRef(patientReplying);
	patientReplyingRef.current = patientReplying;
	/** 打断判据：患者**仍在说话或出声**。回复已结束但 TTS 还在播完最后几句时同样成立。 */
	const patientAudibleRef = useRef(patientReplying || patientSpeaking);
	patientAudibleRef.current = patientReplying || patientSpeaking;
	const startRef = useRef<() => void>(() => {});

	const setTranscriptBoth = useCallback((text: string) => {
		transcriptRef.current = text;
		setTranscript(text);
	}, []);

	const clearSilenceTimer = useCallback(() => {
		clearTimeout(silenceTimerRef.current);
		silenceTimerRef.current = undefined;
	}, []);

	const clearRestartTimer = useCallback(() => {
		clearTimeout(restartTimerRef.current);
		restartTimerRef.current = undefined;
	}, []);

	/** 唯一发送出口：异常不能从 ASR 供应商回调里逃逸成未处理错误。 */
	const send = useCallback(
		(text: string) => {
			setTranscriptBoth("");
			try {
				onSendRef.current(text);
			} catch (err) {
				console.error("[useVoiceDialogue] 语音转写发送失败", err);
				setPhase("idle");
				setNotice("语音消息发送失败，请改用文字输入重试");
			}
		},
		[setTranscriptBoth],
	);

	/** 按住模式收尾：把当前转写作为学生消息发送，失败则回退提示。 */
	const finalizeHold = useCallback(
		(text: string) => {
			if (finalizedRef.current) return;
			finalizedRef.current = true;
			clearSilenceTimer();
			listeningRef.current = false;

			const trimmed = text.trim();
			if (!trimmed) {
				setPhase("idle");
				setNotice("没听清，请重试");
				setTranscriptBoth("");
				return;
			}
			setPhase("sending");
			send(trimmed);
		},
		[clearSilenceTimer, send, setTranscriptBoth],
	);

	/** 持续模式收尾：提交本句后继续听（`nextPhase`），或关闭麦克风（idle）。 */
	const commitContinuous = useCallback(
		(nextPhase: VoicePhase) => {
			clearSilenceTimer();
			const trimmed = transcriptRef.current.trim();
			setTranscriptBoth("");
			consumedRef.current = rawRef.current.length;
			bargeInRef.current = false;
			setInterrupted(false);
			setPhase(nextPhase);
			if (trimmed) send(trimmed);
		},
		[clearSilenceTimer, send, setTranscriptBoth],
	);

	/** 关麦（不提交）：清计时器、停止底层识别会话。 */
	const closeSession = useCallback(() => {
		clearSilenceTimer();
		clearRestartTimer();
		listeningRef.current = false;
		wantListenRef.current = false;
		const session = sessionRef.current;
		sessionRef.current = null;
		try {
			session?.stop();
		} catch {
			/* ignore */
		}
	}, [clearSilenceTimer, clearRestartTimer]);

	/** 持续模式不可用（权限/设备/反复被中断）：降级按住说话并说明原因。 */
	const failContinuous = useCallback(
		(message: string) => {
			continuousFailedRef.current = true;
			setContinuousFailed(true);
			setContinuousArmed(false);
			wantListenRef.current = false;
			listeningRef.current = false;
			const session = sessionRef.current;
			sessionRef.current = null;
			try {
				session?.stop();
			} catch {
				/* ignore */
			}
			setPhase("idle");
			setNotice(message);
		},
		[],
	);

	/** 开始聆听：通过 ASR 供应商拉起一次识别会话。 */
	const start = useCallback(() => {
		if (listeningRef.current) return;
		if (!supported) {
			setNotice("当前浏览器不支持语音输入（建议 Chrome/Edge）");
			return;
		}

		const wantContinuous = continuous && !continuousFailedRef.current;
		// 按住模式是半双工：患者回复中不可开口。持续模式必须允许（否则打断无从发生）。
		if (!wantContinuous && patientReplyingRef.current) return;

		let session: AsrSession;
		try {
			session = asrProvider.createSession({ lang, interimResults: true, continuous: wantContinuous });
		} catch (err) {
			console.warn("[useVoiceDialogue] 识别会话创建失败", err);
			if (wantContinuous) {
				failContinuous("持续对谈启动失败（麦克风权限被拒或浏览器限制），已改为按住说话");
			} else {
				setNotice("语音输入启动失败");
			}
			return;
		}

		clearSilenceTimer();
		clearRestartTimer();
		finalizedRef.current = false;
		rawRef.current = "";
		consumedRef.current = 0;
		bargeInRef.current = false;
		setInterrupted(false);
		sessionRef.current = session;
		listeningRef.current = true;
		setPhase("listening");
		setNotice(null);

		const startedAt = Date.now();

		if (wantContinuous) {
			wantListenRef.current = true;
			setContinuousArmed(true);
			const endpointMs = silenceMs > 0 ? silenceMs : DEFAULT_ENDPOINT_MS;

			session.onresult = ({ transcript: acc }) => {
				rawRef.current = acc;
				// 部分实现会在每个 final 段后清空 results：累计变短即视为会话重置
				if (acc.length < consumedRef.current) consumedRef.current = 0;
				const pending = acc.slice(consumedRef.current);
				setTranscriptBoth(pending);
				if (!pending.trim()) return;

				// 打断：患者还在说话/出声时学生开口 → 立刻停播 + 取消在途生成（每次发言一次）
				if (!bargeInRef.current && patientAudibleRef.current) {
					bargeInRef.current = true;
					setInterrupted(true);
					try {
						onBargeInRef.current?.();
					} catch (err) {
						console.error("[useVoiceDialogue] 打断处理失败", err);
					}
				}

				// 端点检测：有新词就重置静音窗口，到点判句尾自动提交
				clearTimeout(silenceTimerRef.current);
				silenceTimerRef.current = setTimeout(() => commitContinuous("listening"), endpointMs);
			};

			session.onend = () => {
				if (!wantListenRef.current) return; // 主动关麦
				const rapid = Date.now() - startedAt < RAPID_END_MS;
				rapidEndRef.current = rapid ? rapidEndRef.current + 1 : 0;
				listeningRef.current = false;
				sessionRef.current = null;
				if (rapidEndRef.current >= RAPID_END_LIMIT) {
					failContinuous("持续对谈被浏览器反复中断，已改为按住说话");
					return;
				}
				// 浏览器收起会话本身就是一个端点信号：先把已说出的部分提交，再重开
				commitContinuous("listening");
				restartTimerRef.current = setTimeout(() => {
					if (wantListenRef.current) startRef.current();
				}, RESTART_BACKOFF_MS);
			};

			session.onerror = (code) => {
				// 连续聆听里 no-speech / aborted 是常态噪声，不是故障
				if (code === "no-speech" || code === "aborted") return;
				if (FATAL_ASR_ERRORS.has(code)) {
					failContinuous("持续对谈不可用（麦克风权限被拒或设备不可用），已改为按住说话");
					return;
				}
				listeningRef.current = false;
				sessionRef.current = null;
				wantListenRef.current = false;
				setContinuousArmed(false);
				setPhase("idle");
				setTranscriptBoth("");
				setNotice("语音识别失败，请点麦克风重试或改用文字输入");
			};
		} else {
			session.onresult = ({ transcript: acc }) => {
				setTranscriptBoth(acc);
				// 可选静音窗口：动态重置，模拟"说完停顿即自动发送"。
				if (silenceMs > 0) {
					clearTimeout(silenceTimerRef.current);
					silenceTimerRef.current = setTimeout(() => finalizeHold(acc), silenceMs);
				}
			};
			session.onend = () => {
				// 识别自然结束（说完停顿 / 手动 stop）——自动收尾发送。
				finalizeHold(transcriptRef.current);
			};
			session.onerror = () => {
				listeningRef.current = false;
				clearSilenceTimer();
				setPhase("idle");
				setNotice("语音识别失败，请重试或改用文字输入");
				setTranscriptBoth("");
			};
		}

		try {
			session.start();
		} catch (err) {
			console.warn("[useVoiceDialogue] 识别启动失败", err);
			sessionRef.current = null;
			if (wantContinuous) {
				failContinuous("持续对谈启动失败（麦克风权限被拒或浏览器限制），已改为按住说话");
			} else {
				listeningRef.current = false;
				setPhase("idle");
				setNotice("语音输入启动失败");
			}
		}
	}, [
		asrProvider,
		supported,
		lang,
		silenceMs,
		continuous,
		clearSilenceTimer,
		clearRestartTimer,
		commitContinuous,
		failContinuous,
		finalizeHold,
		setTranscriptBoth,
	]);
	startRef.current = start;

	/** 停止聆听：持续模式关麦（已说出的部分照常提交），按住模式立即收尾发送。 */
	const stop = useCallback(() => {
		if (wantListenRef.current) {
			closeSession();
			setContinuousArmed(false);
			if (transcriptRef.current.trim()) commitContinuous("idle");
			else setPhase("idle");
			return;
		}
		if (!listeningRef.current) return;
		clearSilenceTimer();
		const session = sessionRef.current;
		sessionRef.current = null;
		try {
			session?.stop();
		} catch {
			/* ignore */
		}
		finalizeHold(transcriptRef.current);
	}, [closeSession, clearSilenceTimer, commitContinuous, finalizeHold]);

	const pressStart = useCallback(() => start(), [start]);
	const pressEnd = useCallback(() => stop(), [stop]);

	const reset = useCallback(() => {
		closeSession();
		setContinuousArmed(false);
		bargeInRef.current = false;
		setInterrupted(false);
		setPhase("idle");
		setTranscriptBoth("");
		setNotice(null);
	}, [closeSession, setTranscriptBoth]);

	/** 患者回复结束（patientReplying 由 true→false）→ 自动重新就绪。 */
	useEffect(() => {
		const replyJustEnded = wasReplyingRef.current && !patientReplying;
		wasReplyingRef.current = patientReplying;
		if (!replyJustEnded) return;
		// 持续模式麦克风一直开着：不需要重新就绪这一步
		if (wantListenRef.current) {
			setPhase("listening");
			return;
		}
		if (autoRearm && supported) {
			start();
		} else {
			setPhase("ready");
		}
	}, [patientReplying, autoRearm, supported, start]);

	// 卸载时停止识别，避免泄漏。
	useEffect(() => {
		return () => {
			clearSilenceTimer();
			clearRestartTimer();
			wantListenRef.current = false;
			const session = sessionRef.current;
			sessionRef.current = null;
			try {
				session?.stop();
			} catch {
				/* ignore */
			}
		};
	}, [clearSilenceTimer, clearRestartTimer]);

	return {
		phase,
		transcript,
		supported,
		notice,
		continuousArmed,
		continuousFailed,
		interrupted,
		start,
		stop,
		pressStart,
		pressEnd,
		reset,
	};
}
