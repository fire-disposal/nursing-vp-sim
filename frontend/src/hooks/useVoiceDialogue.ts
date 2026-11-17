import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	defaultAsrProvider,
	fallbackAsrProvider,
	type AsrProvider,
	type AsrSession,
} from "@/engine/asr";
import { VoiceTurnController, type TurnPhase } from "@/engine/asr/turnController";
import type { VoicePhase } from "@/hooks/voiceTypes";

export type { VoicePhase };

/**
 * useVoiceDialogue — 语音对答状态机。两种模式共用同一套出口：
 *
 * 1. **按住说话（半双工，降级路径）**：点/按住说话 → 实时转写字幕 → 说完自动发送 →
 *    患者回复 → 自动重新就绪。`silenceMs` 为说完静音窗口（0 = 仅依赖识别自然结束）。
 * 2. **持续对谈（双工）**：`continuous: true` —— 一次开启即常开聆听。轮次由供应商上报：
 *    - 有 VAD：speechStart 开一轮 → speechRealStart(≥250ms) 才可能打断患者 →
 *      speechEnd 进入端点等待 → **definite 非空才提交**（每轮最多一次 onSend）；
 *    - 无 VAD（Web Speech / 云 ASR 降级）：interim + 静音窗口 `silenceMs` 判句尾，
 *      interim 有内容且患者在出声时打断（旧行为）。
 *    设备跑不动 VAD（性能校准不通过/运行中持续滞后）→ `basicVoiceMode`，只留 PCM + 云 ASR。
 *
 * 供应商：默认同源云 ASR（豆包流式 + PCM16LE），服务端没配（4401）/初始化失败时自动落到
 * 浏览器 Web Speech，并把 `basicVoiceMode` 提示给学生（不打断当前输入）。
 *
 * 契约：
 *   `onSend(text)`     —— 唯一语义出口（与文本输入共用）
 *   `onBargeIn()`      —— 患者出声时学生有效开口（≥250ms）触发一次
 *   `recordId`/`token` —— 云 ASR 鉴权与资源归属（token 来自 authStore，调用方传入）
 */

/** 持续模式未给 `silenceMs` 时的端点窗口兜底（无 VAD 时用）。 */
const DEFAULT_ENDPOINT_MS = 1200;
/** 持续会话开启后立刻结束 → 计为一次"被浏览器打断"，连续多次即认定持续模式不可用。 */
const RAPID_END_MS = 500;
const RAPID_END_LIMIT = 3;
/** 重复开启持续会话前的退避（浏览器收起会话是常态，不是错误）。 */
const RESTART_BACKOFF_MS = 250;
/** 权限/设备类致命错误：持续模式不可用，必须降级按住说话（其余错误按可重试处理）。 */
const FATAL_ASR_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);
/** 云 ASR 关闭原因 → 是否应该整体降级到 Web Speech（只有"服务端没配"）。 */
const DISABLED_REASONS: Record<string, true> = { disabled: true };
/** 基础语音模式（VAD 跟不上实时 / 云转写不可用）的唯一文案。 */
export const BASIC_VOICE_NOTICE = "当前设备已使用基础语音模式";

export interface UseVoiceDialogueOptions {
	/** 唯一语义出口：文本 / 转写 / 通话最终都落到这一条学生消息。 */
	onSend: (text: string) => void;
	/** 患者是否正在回复（= 训练 store 的 `sending`）。 */
	patientReplying: boolean;
	/**
	 * 患者是否正在**出声**（TTS 播放中，= 总线 `tts:start`→`tts:end` 之间）。
	 * 回复结束后 TTS 仍在播完最后几句：这段时间学生开口同样是打断。
	 */
	patientSpeaking?: boolean;
	/** 静音窗口（ms）：到点判句尾自动提交；0 = 按住模式仅依赖识别自然结束（onEnd）。 */
	silenceMs?: number;
	/** 识别语言，默认 zh-CN。 */
	lang?: string;
	/** 患者在回复结束后是否自动重新开始聆听（默认 false；按住模式用，持续模式本来就常开）。 */
	autoRearm?: boolean;
	/** ASR 供应商（依赖注入）。默认同源云 ASR。 */
	asrProvider?: AsrProvider;
	/** 降级供应商（云 ASR 不可用时）。默认浏览器 Web Speech。 */
	fallbackProvider?: AsrProvider;
	/**
	 * 持续对谈：常开聆听 + 端点判句尾 + 患者说话时开口即打断。
	 * 启动失败（麦克风权限被拒 / 浏览器限制）→ `continuousFailed=true`，由调用方降级为按住说话。
	 */
	continuous?: boolean;
	/** 打断出口：学生开始说话而患者仍在说话/回复时触发**一次**。 */
	onBargeIn?: () => void;
	/** 训练记录 id（云 ASR 资源归属）。缺省 = 云 ASR 不可用，直接走 Web Speech。 */
	recordId?: number | null;
	/** 会话令牌（云 ASR 的 WS 鉴权）。缺省 = 云 ASR 不可用。 */
	token?: string | null;
	/**
	 * 学生开口时是否暂停云端播放（调用方负责真正暂停）。
	 * 持续模式下唯一可靠的回采手段：浏览器 AEC 只减掉 Web Audio 的声音，
	 * 云 ASR 吃的是处理前音频，患者的 TTS 会被当成学生说话。
	 */
	onSpeechStart?: () => void;
	/** 患者 TTS 当前输出 RMS；传到底层回声门，丢弃回录 PCM 与 VAD 假轮次。 */
	echoLevel?: () => number;
	/** 打断闸门：默认 vad；电话页用 asr，等文本确认后再停播。 */
	bargeInGate?: "vad" | "asr";
	/** 额外文本闸门：返回 true 表示这句不允许触发打断。 */
	bargeInGuard?: (text: string) => boolean;
	/** ASR 打断最小字符数，电话页用 2。 */
	bargeInMinChars?: number;
}

export interface UseVoiceDialogueResult {
	phase: VoicePhase;
	/** 实时转写字幕（只含**本句**未提交的部分）。 */
	transcript: string;
	/** 当前运行时是否支持语音输入。 */
	supported: boolean;
	/** VAD 真正检测到学生开口（不是"麦克风已开启"）。 */
	speechActive: boolean;
	/** 错误/提示文案（没听清、不支持、启动失败等）。 */
	notice: string | null;
	/** 持续对谈是否已开启（麦克风常开）。 */
	continuousArmed: boolean;
	/** 持续对谈启动失败 → 调用方应降级为按住说话，并把原因呈现给学生。 */
	continuousFailed: boolean;
	/** 本次学生发言是以打断患者开始的（用于输入区的可见反馈）。 */
	interrupted: boolean;
	/** 当前走的是基础语音模式（VAD 跟不上实时 / 云转写不可用），提示文案在 `notice`。 */
	basicVoiceMode: boolean;
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
	fallbackProvider = fallbackAsrProvider,
	continuous = false,
	onBargeIn,
	recordId,
	token,
	onSpeechStart,
	echoLevel,
	bargeInGate,
	bargeInGuard,
	bargeInMinChars,
}: UseVoiceDialogueOptions): UseVoiceDialogueResult {
	const [phase, setPhase] = useState<VoicePhase>("idle");
	const [transcript, setTranscript] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const [continuousArmed, setContinuousArmed] = useState(false);
	const [continuousFailed, setContinuousFailed] = useState(false);
	const [interrupted, setInterrupted] = useState(false);
	const [speechActive, setSpeechActive] = useState(false);
	const [basicVoiceMode, setBasicVoiceMode] = useState(false);

	useEffect(() => {
		if (phase !== "listening") setSpeechActive(false);
	}, [phase]);

	/** 云 ASR 需要 token + recordId；缺任何一个都直接走 Web Speech。 */
	const cloudReady = !!token && typeof recordId === "number" && Number.isFinite(recordId);

	const probe = useCallback((provider: AsrProvider) => {
		try {
			return provider.supported();
		} catch (err) {
			console.warn("[useVoiceDialogue] ASR 能力探测失败，按不支持处理", err);
			return false;
		}
	}, []);

	const primarySupported = useMemo(() => cloudReady && probe(asrProvider), [cloudReady, asrProvider, probe]);
	const fallbackSupported = useMemo(() => probe(fallbackProvider), [fallbackProvider, probe]);
	const supported = primarySupported || fallbackSupported;

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
	/** 供应商的累计转写位移（无 VAD 时用来切出本句）。 */
	const consumedRef = useRef(0);
	const rapidEndRef = useRef(0);
	/** 云 ASR 整体不可用（4401/初始化失败）：本页后续都用降级供应商。 */
	const downgradedRef = useRef(!primarySupported);
	const turnRef = useRef<VoiceTurnController | null>(null);
	/** 最新 phase（供应商回调里读，不重建回调）。 */
	const phaseRef = useRef<VoicePhase>("idle");
	phaseRef.current = phase;

	// 保持最新引用，避免重建识别会话。
	const onSendRef = useRef(onSend);
	onSendRef.current = onSend;
	const onBargeInRef = useRef(onBargeIn);
	onBargeInRef.current = onBargeIn;
	const onSpeechStartRef = useRef(onSpeechStart);
	onSpeechStartRef.current = onSpeechStart;
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

	/** 持续模式（无 VAD 的旧路径）收尾：提交本句后继续听（`nextPhase`），或关闭麦克风。 */
	const commitContinuous = useCallback(
		(nextPhase: VoicePhase) => {
			clearSilenceTimer();
			const trimmed = transcriptRef.current.trim();
			setTranscriptBoth("");
			consumedRef.current = 0;
			setInterrupted(false);
			setPhase(nextPhase);
			if (trimmed) send(trimmed);
		},
		[clearSilenceTimer, send, setTranscriptBoth],
	);

	/** 关麦（不提交）：作废当前 epoch（迟到事件一律丢弃）、停止底层会话。 */
	const closeSession = useCallback(() => {
		clearSilenceTimer();
		clearRestartTimer();
		listeningRef.current = false;
		wantListenRef.current = false;
		turnRef.current?.dispose();
		turnRef.current = null;
		const session = sessionRef.current;
		sessionRef.current = null;
		try {
			session?.stop();
		} catch {
			/* ignore */
		}
	}, [clearSilenceTimer, clearRestartTimer]);

	/** 持续模式不可用（权限/设备/反复被中断）：降级按住说话并说明原因。 */
	const failContinuous = useCallback((message: string) => {
		continuousFailedRef.current = true;
		setContinuousFailed(true);
		setContinuousArmed(false);
		wantListenRef.current = false;
		listeningRef.current = false;
		turnRef.current?.dispose();
		turnRef.current = null;
		const session = sessionRef.current;
		sessionRef.current = null;
		try {
			session?.stop();
		} catch {
			/* ignore */
		}
		setPhase("idle");
		setNotice(message);
	}, []);

	/** 持续模式的状态机：供应商事件 → VoiceTurnController（epoch 隔离在控制器里）。 */
	const makeTurnController = useCallback((): VoiceTurnController => {
		return new VoiceTurnController(
			{
				onSend: (text) => send(text),
				onBargeIn: () => {
					try {
						onBargeInRef.current?.();
					} catch (err) {
						console.error("[useVoiceDialogue] 打断处理失败", err);
					}
				},
				onPhase: (next: TurnPhase) => setPhase(next),
				onTranscript: (text) => setTranscriptBoth(text),
				onInterrupted: (value) => setInterrupted(value),
				onNotice: (value) => setNotice(value),
				onSpeechStart: () => {
					try {
						onSpeechStartRef.current?.();
					} catch (err) {
						console.error("[useVoiceDialogue] 开口处理失败", err);
					}
				},
			},
			{
				patientAudible: () => patientAudibleRef.current,
				endpointMs: silenceMs > 0 ? silenceMs : DEFAULT_ENDPOINT_MS,
				bargeInGate,
				bargeInGuard,
				bargeInMinChars,
			},
		);
	}, [send, setTranscriptBoth, silenceMs, bargeInGate, bargeInGuard, bargeInMinChars]);

	/** 云 ASR 整体降级：换供应商重开这一轮（不关闭麦克风手势）。 */
	const downgradeToFallback = useCallback(
		(reason: string) => {
			downgradedRef.current = true;
			setBasicVoiceMode(true);
			setNotice(reason);
			const session = sessionRef.current;
			sessionRef.current = null;
			turnRef.current?.dispose();
			turnRef.current = null;
			try {
				session?.stop();
			} catch {
				/* ignore */
			}
			listeningRef.current = false;
			if (wantListenRef.current && fallbackProvider.supported()) {
				// 手势仍在：立刻用降级供应商重开，学生感知到的是"继续说就行"
				startRef.current();
			}
		},
		[fallbackProvider],
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

		const useCloud = !downgradedRef.current && primarySupported;
		const provider = useCloud ? asrProvider : fallbackProvider;

		let session: AsrSession;
		try {
			session = provider.createSession({
				lang,
				interimResults: true,
				continuous: wantContinuous,
				recordId: recordId ?? undefined,
				token: token ?? undefined,
				vad: wantContinuous,
				echoLevel,
			});
		} catch (err) {
			console.warn("[useVoiceDialogue] 识别会话创建失败", err);
			if (useCloud) {
				downgradeToFallback(BASIC_VOICE_NOTICE);
				return;
			}
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
		consumedRef.current = 0;
		setInterrupted(false);
		sessionRef.current = session;
		listeningRef.current = true;
		setPhase("listening");
		// 只有真正降级过才保留这条常驻说明；正常启动时清掉上一轮的提示。
		setNotice(downgradedRef.current ? BASIC_VOICE_NOTICE : null);

		const startedAt = Date.now();
		/**
		 * 供应商回调的门：会话已被换掉（新的 start）或主动关麦（`closeSession` 把
		 * `sessionRef` 置空）之后，所有迟到事件一律丢弃。
		 */
		const isLive = () => sessionRef.current === session && listeningRef.current;

		if (wantContinuous) {
			wantListenRef.current = true;
			setContinuousArmed(true);
			const controller = makeTurnController();
			turnRef.current = controller;
			const epoch = controller.start();

			/** 供应商上报 VAD 轮次：事件带 epoch 进控制器，迟到的自然被拒。 */
			session.onSpeechStart = () => {
				if (!isLive()) return;
				setSpeechActive(true);
				controller.speechStart(epoch);
			};
			session.onSpeechRealStart = () => {
				if (!isLive()) return;
				controller.speechRealStart(epoch);
			};
			session.onSpeechEnd = () => {
				if (!isLive()) return;
				setSpeechActive(false);
				controller.speechEnd(epoch);
			};
			session.onPartial = (text) => {
				if (!isLive()) return;
				controller.partial(text, epoch);
			};
			session.onDefinite = (text) => {
				if (!isLive()) return;
				setSpeechActive(false);
				controller.definite(text, epoch);
			};
			session.onInterim = (text) => {
				if (!isLive()) return;
				// 无 VAD（Web Speech / 云 ASR 基础模式）：本句 = 累计 − 已提交。
				controller.interim(text.slice(consumedRef.current), epoch);
				consumedRef.current = 0;
			};
			session.onPerformance = (state) => {
				if (!isLive()) return;
				if (state === "degraded") setBasicVoiceMode(true);
				if (state === "degraded") setNotice(BASIC_VOICE_NOTICE);
				else if (state === "ok") setBasicVoiceMode(false);
			};
			session.onReady = () => {
				if (!isLive()) return;
				setNotice(null);
			};

			session.onEnd = () => {
				if (!wantListenRef.current || !isLive()) return; // 主动关麦 / 旧会话
				// 只有"开了又立刻被关"才计被浏览器打断：活过 RAPID_END_MS 的会话正常收尾不计。
				const rapid = Date.now() - startedAt < RAPID_END_MS;
				rapidEndRef.current = rapid ? rapidEndRef.current + 1 : 0;
				listeningRef.current = false;
				sessionRef.current = null;
				controller.dispose();
				turnRef.current = null;
				if (rapidEndRef.current >= RAPID_END_LIMIT) {
					failContinuous("持续对谈被浏览器反复中断，已改为按住说话");
					return;
				}
				// 会话被收起不是学生说完：迟到的 definite 已被控制器作废，
				// 这里只清字幕并重开，不抢发半句（提交只认本轮的 definite）。
				setTranscriptBoth("");
				setInterrupted(false);
				if (phaseRef.current !== "sending") setPhase("listening");
				restartTimerRef.current = setTimeout(() => {
					if (wantListenRef.current) startRef.current();
				}, RESTART_BACKOFF_MS);
			};

			session.onError = (code) => {
				if (!isLive()) return;
				// 连续聆听里 no-speech / aborted 是常态噪声，不是故障
				if (code === "no-speech" || code === "aborted") return;
				if (DISABLED_REASONS[code]) {
					downgradeToFallback(BASIC_VOICE_NOTICE);
					return;
				}
				if (FATAL_ASR_ERRORS.has(code)) {
					failContinuous("持续对谈不可用（麦克风权限被拒或设备不可用），已改为按住说话");
					return;
				}
				listeningRef.current = false;
				sessionRef.current = null;
				wantListenRef.current = false;
				controller.dispose();
				turnRef.current = null;
				setContinuousArmed(false);
				setPhase("idle");
				setTranscriptBoth("");
				setNotice("语音识别失败，请点麦克风重试或改用文字输入");
			};
		} else {
			session.onPartial = (text) => {
				if (!isLive()) return;
				setSpeechActive(Boolean(text.trim()));
				setTranscriptBoth(text);
				if (silenceMs > 0) {
					clearTimeout(silenceTimerRef.current);
					silenceTimerRef.current = setTimeout(() => finalizeHold(text), silenceMs);
				}
			};
			session.onDefinite = (text) => {
				if (!isLive()) return;
				setSpeechActive(false);
				setTranscriptBoth(text);
			};
			session.onInterim = (text) => {
				if (!isLive()) return;
				setTranscriptBoth(text);
				if (silenceMs > 0) {
					clearTimeout(silenceTimerRef.current);
					silenceTimerRef.current = setTimeout(() => finalizeHold(text), silenceMs);
				}
			};
			session.onEnd = () => {
				if (!isLive()) return;
				// 识别自然结束（说完停顿 / 手动 stop）——自动收尾发送。
				finalizeHold(transcriptRef.current);
			};
			session.onError = (code) => {
				if (!isLive()) return;
				if (DISABLED_REASONS[code]) {
					downgradeToFallback(BASIC_VOICE_NOTICE);
					return;
				}
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
			if (sessionRef.current === session) sessionRef.current = null;
			if (useCloud) {
				downgradeToFallback(BASIC_VOICE_NOTICE);
				return;
			}
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
		fallbackProvider,
		supported,
		primarySupported,
		lang,
		silenceMs,
		continuous,
		clearSilenceTimer,
		clearRestartTimer,
		commitContinuous,
		downgradeToFallback,
		failContinuous,
		finalizeHold,
		makeTurnController,
		recordId,
		setTranscriptBoth,
		token,
		echoLevel,
	]);

	startRef.current = start;

	/** 停止聆听：持续模式关麦（已说出的部分照常提交），按住模式立即收尾发送。 */
	const stop = useCallback(() => {
		if (wantListenRef.current) {
			// 关麦 = 学生主动收尾：说出口的内容照常提交（控制器已作废，直接发）。
			const pending = transcriptRef.current.trim();
			closeSession();
			setContinuousArmed(false);
			setTranscriptBoth("");
			setInterrupted(false);
			setPhase("idle");
			if (pending) send(pending);
			return;
		}
		if (!listeningRef.current) return;
		clearSilenceTimer();
		// 先让门关上（迟到的 onEnd 不得再触发一次收尾），再停底层会话
		listeningRef.current = false;
		const session = sessionRef.current;
		sessionRef.current = null;
		try {
			session?.stop();
		} catch {
			/* ignore */
		}
		finalizeHold(transcriptRef.current);
	}, [closeSession, clearSilenceTimer, finalizeHold, send, setTranscriptBoth]);

	const pressStart = useCallback(() => start(), [start]);
	const pressEnd = useCallback(() => stop(), [stop]);

	const reset = useCallback(() => {
		closeSession();
		setContinuousArmed(false);
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

	// 卸载时停止识别并作废所有在途事件。
	useEffect(() => {
		return () => {
			clearSilenceTimer();
			clearRestartTimer();
			wantListenRef.current = false;
			turnRef.current?.dispose();
			turnRef.current = null;
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
		speechActive,
		notice,
		continuousArmed,
		continuousFailed,
		interrupted,
		basicVoiceMode,
		start,
		stop,
		pressStart,
		pressEnd,
		reset,
	};
}
