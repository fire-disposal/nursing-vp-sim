import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultAsrProvider, type AsrProvider, type AsrSession } from "@/engine/asr";

/**
 * useVoiceDialogue — 半双工语音对答的状态机（方案 A 的基础件）。
 *
 * 把「学生语音 → 患者语音回复」的前端编排收敛成一个可测试的 hook：
 *   点/按住说话 → 实时转写字幕 → 说完自动发送 → 患者回复(pending) → 自动重新就绪
 * 后端零改动：最终仍是 `onSend(text)` 走现有 SSE 聊天管道 + 现有 Volc TTS 输出。
 *
 * 契约：
 *   `onSend(text)`            —— 唯一语义出口（与文本输入共用）
 *   `patientReplying`         —— 训练 store 的 `sending`（患者是否正在回复）
 *   `silenceMs`               —— 说完静音窗口，到点自动发送（0 = 仅依赖识别 onend）
 *   `asrProvider`             —— 依赖注入 ASR 供应商，默认 `defaultAsrProvider`（Web Speech），
 *                               未来可换在线 ASR 而不改本 hook。
 *
 * 状态机：
 *   idle ──start──▶ listening ──说完/松开──▶ sending ──▶ awaiting(患者回复中)
 *   awaiting ──patientReplying=false──▶ ready（"该你说话了"）──start──▶ listening
 *   任意态遇到不支持/错误 → idle + notice。
 */

export type VoicePhase = "idle" | "listening" | "sending" | "awaiting" | "ready";

export interface UseVoiceDialogueOptions {
	/** 唯一语义出口：文本 / 转写 / 通话最终都落到这一条学生消息。 */
	onSend: (text: string) => void;
	/** 患者是否正在回复（= 训练 store 的 `sending`）。true 禁用输入，false 自动重新就绪。 */
	patientReplying: boolean;
	/** 说完没有新词的静音窗口（ms），到点自动发送；0 = 仅依赖识别自然结束（onend）。默认 0。 */
	silenceMs?: number;
	/** 识别语言，默认 zh-CN。 */
	lang?: string;
	/** 患者在回复结束后是否自动重新开始聆听（默认 false；true 需浏览器允许无手势启动麦克风）。 */
	autoRearm?: boolean;
	/** ASR 供应商（依赖注入）。默认 `defaultAsrProvider`（Web Speech）。 */
	asrProvider?: AsrProvider;
}

export interface UseVoiceDialogueResult {
	phase: VoicePhase;
	/** 实时转写字幕（interim + final 拼接）。 */
	transcript: string;
	/** 当前运行时是否支持语音输入。 */
	supported: boolean;
	/** 错误/提示文案（没听清、不支持、启动失败等）。 */
	notice: string | null;
	start: () => void;
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
	silenceMs = 0,
	lang = "zh-CN",
	autoRearm = false,
	asrProvider = defaultAsrProvider,
}: UseVoiceDialogueOptions): UseVoiceDialogueResult {
	const [phase, setPhase] = useState<VoicePhase>("idle");
	const [transcript, setTranscript] = useState("");
	const [notice, setNotice] = useState<string | null>(null);

	// 供应商能力可能在运行时不变（浏览器特性稳定），一次性探测。
	const supported = useMemo(() => asrProvider.supported(), [asrProvider]);

	const sessionRef = useRef<AsrSession | null>(null);
	const listeningRef = useRef(false);
	const transcriptRef = useRef("");
	const finalizedRef = useRef(false);
	const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const wasReplyingRef = useRef(patientReplying);

	// 保持最新引用，避免重建识别会话。
	const onSendRef = useRef(onSend);
	onSendRef.current = onSend;
	const patientReplyingRef = useRef(patientReplying);
	patientReplyingRef.current = patientReplying;

	const setTranscriptBoth = useCallback((text: string) => {
		transcriptRef.current = text;
		setTranscript(text);
	}, []);

	const clearSilenceTimer = useCallback(() => {
		clearTimeout(silenceTimerRef.current);
		silenceTimerRef.current = undefined;
	}, []);

	/** 收尾：把当前转写作为学生消息发送，失败则回退提示。 */
	const finalize = useCallback(
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
			setTranscriptBoth("");
			setPhase("sending");
			onSendRef.current(trimmed);
		},
		[clearSilenceTimer, setTranscriptBoth],
	);

	/** 手动停止：立即收尾当前转写（tap 结束 / 松手）。 */
	const stop = useCallback(() => {
		if (!listeningRef.current) return;
		clearSilenceTimer();
		try {
			sessionRef.current?.stop();
		} catch {
			/* ignore */
		}
		finalize(transcriptRef.current);
	}, [clearSilenceTimer, finalize]);

	/** 开始聆听：通过 ASR 供应商拉起一次识别会话。 */
	const start = useCallback(() => {
		if (listeningRef.current) return;
		if (!supported) {
			setNotice("当前浏览器不支持语音输入（建议 Chrome/Edge）");
			return;
		}
		if (patientReplyingRef.current) return; // 半双工：患者回复中不可开启

		let session: AsrSession;
		try {
			session = asrProvider.createSession({ lang, interimResults: true, continuous: false });
		} catch {
			setNotice("语音输入启动失败");
			return;
		}
		clearSilenceTimer();

		session.onresult = ({ transcript: acc }) => {
			setTranscriptBoth(acc);
			// 可选静音窗口：动态重置，模拟"说完停顿即自动发送"。
			if (silenceMs > 0) {
				clearTimeout(silenceTimerRef.current);
				silenceTimerRef.current = setTimeout(() => finalize(acc), silenceMs);
			}
		};
		session.onend = () => {
			// 识别自然结束（说完停顿 / 手动 stop）——自动收尾发送。
			finalize(transcriptRef.current);
		};
		session.onerror = () => {
			listeningRef.current = false;
			clearSilenceTimer();
			setPhase("idle");
			setNotice("语音识别失败，请重试或改用文字输入");
			setTranscriptBoth("");
		};

		finalizedRef.current = false;
		sessionRef.current = session;
		listeningRef.current = true;
		setPhase("listening");
		setNotice(null);
		try {
			session.start();
		} catch {
			listeningRef.current = false;
			setPhase("idle");
			setNotice("语音输入启动失败");
		}
	}, [asrProvider, supported, lang, silenceMs, clearSilenceTimer, finalize, setTranscriptBoth]);

	const pressStart = useCallback(() => start(), [start]);
	const pressEnd = useCallback(() => stop(), [stop]);

	const reset = useCallback(() => {
		clearSilenceTimer();
		listeningRef.current = false;
		try {
			sessionRef.current?.stop();
		} catch {
			/* ignore */
		}
		setPhase("idle");
		setTranscriptBoth("");
		setNotice(null);
	}, [clearSilenceTimer, setTranscriptBoth]);

	/** 患者回复结束（patientReplying 由 true→false）→ 自动重新就绪。 */
	useEffect(() => {
		const replyJustEnded = wasReplyingRef.current && !patientReplying;
		wasReplyingRef.current = patientReplying;
		if (!replyJustEnded) return;
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
			try {
				sessionRef.current?.stop();
			} catch {
				/* ignore */
			}
		};
	}, [clearSilenceTimer]);

	return { phase, transcript, supported, notice, start, stop, pressStart, pressEnd, reset };
}
