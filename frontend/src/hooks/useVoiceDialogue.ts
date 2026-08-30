import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
 *
 * 状态机：
 *   idle ──start──▶ listening ──说完/松开──▶ sending ──▶ awaiting(患者回复中)
 *   awaiting ──patientReplying=false──▶ ready（"该你说话了"）──start──▶ listening
 *   任意态遇到不支持/错误 → idle + notice。
 *
 * 说明：`SpeechRecognition` 为浏览器 Web Speech API（Chrome/Edge 内建）。
 * 类型已在 `src/types/globals.d.ts` 全局声明，本文件仅做运行时构造拉取。
 */

type SpeechRecognitionCtor = new () => SpeechRecognition;

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
}

export interface UseVoiceDialogueResult {
	phase: VoicePhase;
	/** 实时转写字幕（interim + final 拼接）。 */
	transcript: string;
	/** 当前浏览器是否支持 Web Speech 语音输入。 */
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

function detectSpeechRecognition(): SpeechRecognitionCtor | null {
	const w = window as unknown as {
		SpeechRecognition?: SpeechRecognitionCtor;
		webkitSpeechRecognition?: SpeechRecognitionCtor;
	};
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceDialogue({
	onSend,
	patientReplying,
	silenceMs = 0,
	lang = "zh-CN",
	autoRearm = false,
}: UseVoiceDialogueOptions): UseVoiceDialogueResult {
	const [phase, setPhase] = useState<VoicePhase>("idle");
	const [transcript, setTranscript] = useState("");
	const [notice, setNotice] = useState<string | null>(null);

	// SpeechRecognition 构造器在模块加载时探测一次（浏览器能力稳定）。
	const Ctor = useMemo(detectSpeechRecognition, []);
	const supported = Ctor !== null;

	const recRef = useRef<SpeechRecognition | null>(null);
	const listeningRef = useRef(false);
	const transcriptRef = useRef("");
	const finalizedRef = useRef(false);
	const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const wasReplyingRef = useRef(patientReplying);

	// 保持 onSend 最新引用，避免重建识别对象。
	const onSendRef = useRef(onSend);
	onSendRef.current = onSend;
	// patientReplying 走 ref，供 onend/静音回调读到最新值。
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

	/** 手动停止：立即收尾当前转写（tap 结束 / 松手）. */
	const stop = useCallback(() => {
		if (!listeningRef.current) return;
		clearSilenceTimer();
		try {
			recRef.current?.stop(); // 触发 onend；finalizedRef 保证只发一次
		} catch {
			/* ignore */
		}
		finalize(transcriptRef.current);
	}, [clearSilenceTimer, finalize]);

	/** 开始聆听：拉起一次识别会话。 */
	const start = useCallback(() => {
		if (listeningRef.current) return;
		if (!Ctor) {
			setNotice("当前浏览器不支持语音输入（建议 Chrome/Edge）");
			return;
		}
		if (patientReplyingRef.current) return; // 半双工：患者回复中不可开启

		clearSilenceTimer();
		const rec = new Ctor();
		rec.lang = lang;
		rec.interimResults = true;
		rec.continuous = false;

		rec.onresult = (e) => {
			let acc = "";
			for (let i = 0; i < e.results.length; i += 1) {
				acc += e.results[i][0].transcript;
			}
			setTranscriptBoth(acc);
			// 可选静音窗口：动态重置，模拟"说完停顿即自动发送"。
			if (silenceMs > 0) {
				clearTimeout(silenceTimerRef.current);
				silenceTimerRef.current = setTimeout(() => finalize(acc), silenceMs);
			}
		};
		rec.onend = () => {
			// 识别自然结束（说完停顿 / 手动 stop）——自动收尾发送。
			finalize(transcriptRef.current);
		};
		rec.onerror = () => {
			listeningRef.current = false;
			clearSilenceTimer();
			setPhase("idle");
			setNotice("语音识别失败，请重试或改用文字输入");
			setTranscriptBoth("");
		};

		finalizedRef.current = false;
		recRef.current = rec;
		listeningRef.current = true;
		setPhase("listening");
		setNotice(null);
		try {
			rec.start();
		} catch {
			listeningRef.current = false;
			setPhase("idle");
			setNotice("语音输入启动失败");
		}
	}, [Ctor, lang, silenceMs, clearSilenceTimer, finalize, setTranscriptBoth]);

	const pressStart = useCallback(() => start(), [start]);
	const pressEnd = useCallback(() => stop(), [stop]);

	const reset = useCallback(() => {
		clearSilenceTimer();
		listeningRef.current = false;
		try {
			recRef.current?.stop();
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
				recRef.current?.stop();
			} catch {
				/* ignore */
			}
		};
	}, [clearSilenceTimer]);

	return { phase, transcript, supported, notice, start, stop, pressStart, pressEnd, reset };
}
