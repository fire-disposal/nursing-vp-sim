import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useAuthStore from "@/stores/authStore";
import { useVoiceDialogue, type UseVoiceDialogueResult } from "@/hooks/useVoiceDialogue";
import { findCharacter, type PhoneCharacter } from "@/engine/phone/characters";
import { classifyUserText, openingLine } from "@/engine/phone/script";
import { streamDemoChat, trimHistory, type DemoHistoryMessage } from "@/engine/phone/chat";
import { EMOTION_DIMS, dominantLabel } from "@/engine/phone/emotion";
import { applyEmotionEffect } from "@/engine/phone/emotionEffect";
import { DemoTTSPlayer } from "@/engine/phone/ttsPlayer";
import type {
	EmotionVector,
	PhoneEmotionLabel,
	PhoneLogEntry,
	PhoneStage,
	ScriptIntent,
} from "@/engine/phone/types";

/**
 * usePhoneCall —— 演示电话的运行时编排。
 *
 * 三条腿，各自只有一个 owner：
 *   - **输入** `useVoiceDialogue`（`recordId: 0` → demo ASR 路由，不碰训练记录）；
 *   - **对话** `POST /api/voice-demo/chat/stream`（后端权威角色 Prompt，SSE 文本块）；
 *   - **状态** 本地四维情绪状态机（`emotionEffect`），驱动 TTS `emotion_state` 与 SVG。
 *
 * 一轮的时序（打断能力全在这里）：
 *   handleUserText → 情绪推进 → 患者占位气泡 → SSE 文本块 → 句子入 TTS 队列
 *   → `patientSpeaking` 期间学生开口 → onBargeIn → abort SSE + 停播 → 提交学生的新话。
 */

export interface PhoneCallLine {
	id: number;
	role: "user" | "patient";
	text: string;
	/** 学生消息的意图标签（本地规则判定，纯展示）。 */
	tag?: ScriptIntent;
	/** 患者这句话被学生打断（只念出去前面一部分）。 */
	interrupted?: boolean;
	/** 患者消息仍在流式生成。 */
	streaming?: boolean;
}

export interface UsePhoneCallOptions {
	characterId: string | null;
	/** 依赖注入（单测用）：语音输入 hook。 */
	voiceHook?: typeof useVoiceDialogue;
	/** 依赖注入（单测用）：TTS 播放器工厂。 */
	playerFactory?: () => DemoTTSPlayer;
	/** 依赖注入（单测用）：LLM SSE 请求。 */
	streamChat?: typeof streamDemoChat;
}

export interface PhoneCallMetrics {
	/** 首块音频延迟（ms）。 */
	firstBlockMs: number | null;
	/** 停播延迟：从打断手势到播放器真正静音（ms）。 */
	stopMs: number | null;
	/** 判句延迟：学生说完 → 开始生成（ms）。 */
	sentenceMs: number | null;
	/** LLM 首字延迟（ms）。 */
	firstTokenMs: number | null;
	/** 当前 TTS 实际音色与情绪（来自响应头）。 */
	voice: string | null;
	ttsEmotion: string | null;
}

export interface UsePhoneCallResult {
	character: PhoneCharacter | null;
	emotion: EmotionVector;
	label: PhoneEmotionLabel;
	stage: PhoneStage;
	lines: PhoneCallLine[];
	log: PhoneLogEntry[];
	metrics: PhoneCallMetrics;
	/** 学生实时转写（ASR partial）。 */
	transcript: string;
	/** 学生对答阶段（useVoiceDialogue 的 phase）。 */
	voicePhase: UseVoiceDialogueResult["phase"];
	/** VAD 真实检测到学生开口（区别于麦克风常开）。 */
	speechActive: boolean;
	continuousArmed: boolean;
	continuousFailed: boolean;
	basicVoiceMode: boolean;
	voiceSupported: boolean;
	voiceNotice: string | null;
	/** 本地文本输入（不经过 ASR，走同一个 handleUserText）。 */
	draft: string;
	setDraft: (value: string) => void;
	/** 当前台词是否正在朗读（驱动口型）。 */
	speaking: boolean;
	/** 当前 TTS 实际输出 RMS（0..1），驱动口型，不做假动画。 */
	ttsLevel: number;
	/** 患者正在生成或出声 —— 学生此时开口即为有效打断。 */
	patientReplying: boolean;
	/** 已经拨出去（播过开场白或已开麦）。 */
	dialed: boolean;
	/** VAD/轮次检测是否可用。 */
	turnDetection: boolean;
	/** 开始通话：打开常开麦克风 + 播开场白。 */
	startCall: () => void;
	/** 停止通话：停播、关麦、阶段置 ended。 */
	stopCall: () => void;
	/** 唯一语义出口：语音转写、快捷按钮、文本输入都走它。 */
	handleUserText: (text: string) => void;
	/** 学生有效打断（患者仍在生成/出声时开口）。 */
	handleBargeIn: () => void;
	/** 快捷测试按钮。 */
	runQuickTest: (kind: "greeting" | "interrupt" | "emotion") => void;
}

const EMPTY: EmotionVector = { trust: 0, anxiety: 0, irritation: 0, cooperation: 0 };

/** 学生"有效打断"的演示台词：长句，用于验证打断链路。 */
export const QUICK_INTERRUPT_TEXT = "等一下，我先打断一下——你慢慢讲，别急，我先说个事。";

export function usePhoneCall({
	characterId,
	voiceHook = useVoiceDialogue,
	playerFactory,
	streamChat = streamDemoChat,
}: UsePhoneCallOptions): UsePhoneCallResult {
	const character = useMemo(() => findCharacter(characterId), [characterId]);
	const token = useAuthStore((s) => s.token);

	const [emotion, setEmotion] = useState<EmotionVector>(() => character?.initial ?? EMPTY);
	const [label, setLabel] = useState<PhoneEmotionLabel>(() =>
		dominantLabel(character?.initial ?? EMPTY),
	);
	const [stage, setStage] = useState<PhoneStage>("idle");
	const [lines, setLines] = useState<PhoneCallLine[]>([]);
	const [log, setLog] = useState<PhoneLogEntry[]>([]);
	const [draft, setDraft] = useState("");
	const [speaking, setSpeaking] = useState(false);
	const [ttsLevel, setTtsLevel] = useState(0);
	const [patientReplying, setPatientReplying] = useState(false);
	const [dialed, setDialed] = useState(false);
	const [metrics, setMetrics] = useState<PhoneCallMetrics>({
		firstBlockMs: null,
		stopMs: null,
		sentenceMs: null,
		firstTokenMs: null,
		voice: null,
		ttsEmotion: null,
	});

	const emotionRef = useRef<EmotionVector>(character?.initial ?? EMPTY);
	const sessionIdRef = useRef(crypto.randomUUID());
	const stageRef = useRef<PhoneStage>("idle");
	const historyRef = useRef<DemoHistoryMessage[]>([]);
	const replyTextRef = useRef("");
	const pendingUserAtRef = useRef<number | null>(null);
	const spokeAtRef = useRef<number | null>(null);
	const ttsSeqRef = useRef(0);
	const seqRef = useRef(0);
	const lineSeqRef = useRef(0);
	const interruptedRef = useRef(false);
	/** 最近 7 秒患者实际念出的句子（归一化），用于丢弃 ASR 回录。 */
	const recentTtsRef = useRef<Array<{ norm: string; at: number }>>([]);
	const lastPatientTextRef = useRef("");
	const lastPatientAtRef = useRef(0);
	/** 当前在途的一轮（abort 用）。 */
	const turnAbortRef = useRef<AbortController | null>(null);
	const patientLineIdRef = useRef<number | null>(null);
	/** 轮次序号：打断/停止时递增 → 旧轮残留的 SSE 帧与 TTS 回调一律作废。 */
	const turnSeqRef = useRef(0);
	/** 一通电话的序号：挂断后，延迟的接通音/开场白不得再启动。 */
	const callSeqRef = useRef(0);

	// 换角色 = 重开一通电话。
	useEffect(() => {
		const initial = character?.initial ?? EMPTY;
		emotionRef.current = initial;
		setEmotion(initial);
		setLabel(dominantLabel(initial));
		stageRef.current = "idle";
		setStage("idle");
		setLines([]);
		setLog([]);
		setDialed(false);
		historyRef.current = [];
		replyTextRef.current = "";
		interruptedRef.current = false;
	}, [character]);

	const playerRef = useRef<DemoTTSPlayer | null>(null);
	if (!playerRef.current) {
		playerRef.current = playerFactory ? playerFactory() : new DemoTTSPlayer({ speaker: character?.speaker });
	}
	const ttsEchoLevel = useCallback(() => playerRef.current?.outputLevel() ?? 0, []);
	const ttsEchoGuard = useCallback((text: string) => isTtsEcho(text, recentTtsRef.current), []);
	const isEchoLike = useCallback((text: string) => {
		if (isTtsEcho(text, recentTtsRef.current)) return true;
		if (!lastPatientTextRef.current || performance.now() - lastPatientAtRef.current > 8000) return false;
		return similarSpeech(normalizeSpeech(text), normalizeSpeech(lastPatientTextRef.current));
	}, []);

	useEffect(() => {
		if (!speaking) {
			setTtsLevel(0);
			return;
		}
		let raf = 0;
		const tick = () => {
			setTtsLevel(playerRef.current?.outputLevel() ?? 0);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [speaking]);

	const pushLog = useCallback((kind: PhoneLogEntry["kind"], text: string) => {
		seqRef.current += 1;
		setLog((prev) => [...prev.slice(-119), { id: seqRef.current, at: Date.now(), kind, text }]);
	}, []);

	/** 患者消息的流式追加：同一个占位气泡逐块长大。 */
	const appendPatientChunk = useCallback((chunk: string) => {
		replyTextRef.current += chunk;
		lastPatientTextRef.current = replyTextRef.current;
		lastPatientAtRef.current = performance.now();
		const id = patientLineIdRef.current;
		if (id === null) return;
		setLines((prev) => prev.map((line) => (line.id === id ? { ...line, text: replyTextRef.current } : line)));
	}, []);

	/** 播放器事件 → 指标 + 事件日志。 */
	useEffect(() => {
		const player = playerRef.current;
		if (!player) return;
		return player.subscribe((event) => {
			switch (event.type) {
				case "first-block":
					setSpeaking(true);
					setMetrics((m) => ({ ...m, firstBlockMs: Math.round(event.ms) }));
					pushLog("tts", `首块音频 ${Math.round(event.ms)}ms${event.fallback ? "（浏览器兜底）" : ""}`);
					break;
				case "sentence":
					recentTtsRef.current = [
						...recentTtsRef.current.filter((item) => performance.now() - item.at < 7000),
						{ norm: normalizeSpeech(event.text), at: performance.now() },
					];
					break;
				case "fallback":
					pushLog("system", `服务端语音不可用（${event.reason}），已切到浏览器朗读`);
					break;
				case "stopped":
					setSpeaking(false);
					break;
				case "error":
					pushLog("error", event.message);
					break;
				case "done":
					setSpeaking(false);
					setMetrics((m) => ({
						...m,
						voice: player.meta.voice ?? m.voice,
						ttsEmotion: player.meta.emotion ?? m.ttsEmotion,
					}));
					break;
			}
		});
	}, [pushLog]);

	useEffect(() => {
		const player = playerRef.current;
		return () => {
			turnAbortRef.current?.abort();
			player?.dispose();
			playerRef.current = null;
		};
	}, []);

	/** 播一段完整台词（开场白这种非流式文本）。 */
	const speakWhole = useCallback(async (text: string) => {
		const player = playerRef.current;
		if (!player) return;
		ttsSeqRef.current += 1;
		const seq = ttsSeqRef.current;
		player.setContext(dominantLabel(emotionRef.current), `phone-${characterId ?? "demo"}`);
		setSpeaking(true);
		await player.speak(text);
		await player.finish();
		await player.waitIdle();
		if (ttsSeqRef.current !== seq) return;
		setSpeaking(false);
	}, [characterId]);

	const settleStage = useCallback(() => {
		if (stageRef.current === "patient_speaking") {
			stageRef.current = "listening";
			setStage("listening");
		}
	}, []);

	/** 一轮生成：SSE 文本块 → 患者气泡 + TTS 队列。 */
	const runTurn = useCallback(
		(text: string, testMode?: "long_response") => {
			if (!character) return;
			const player = playerRef.current;
			turnSeqRef.current += 1;
			const turnId = turnSeqRef.current;
			const abort = new AbortController();
			turnAbortRef.current = abort;
			replyTextRef.current = "";
			lastPatientTextRef.current = "";
			lastPatientAtRef.current = 0;
			lineSeqRef.current += 1;
			const placeholderId = lineSeqRef.current;
			patientLineIdRef.current = placeholderId;
			setLines((prev) => [
				...prev,
				{ id: placeholderId, role: "patient", text: "", streaming: true },
			]);
			stageRef.current = "patient_speaking";
			setStage("patient_speaking");
			setPatientReplying(true);
			spokeAtRef.current = null;
			const startedAt = performance.now();
			player?.setContext(dominantLabel(emotionRef.current), `phone-${character.id}`);

			void streamChat(
				{
					character_id: character.id,
					session_id: sessionIdRef.current,
					history: trimHistory(historyRef.current),
					emotion_state: dominantLabel(emotionRef.current),
					...(testMode ? { test_mode: testMode } : {}),
				},
				{
					signal: abort.signal,
					onChunk: (chunk) => {
						if (turnSeqRef.current !== turnId) return;
						if (spokeAtRef.current === null) {
							spokeAtRef.current = performance.now();
							setMetrics((m) => ({ ...m, firstTokenMs: Math.round(spokeAtRef.current! - startedAt) }));
						}
						appendPatientChunk(chunk);
						void player?.speak(chunk);
					},
					onError: (message) => {
						if (turnSeqRef.current !== turnId) return;
						pushLog("error", message);
					},
					onDone: () => {
						if (turnSeqRef.current !== turnId) return;
						void player?.finish();
					},
				},
			)
				.then((full) => {
					if (turnSeqRef.current !== turnId) return;
					setLines((prev) =>
						prev.map((line) =>
							line.id === placeholderId ? { ...line, streaming: false, text: full || line.text } : line,
						),
					);
					const reply = (full || replyTextRef.current).trim();
					if (!reply) {
						pushLog("error", "没有收到回复内容");
						return;
					}
					historyRef.current = trimHistory([
						...historyRef.current,
						{ role: "student", content: text },
						{ role: "patient", content: reply },
					]);
					pushLog("patient", `${reply.slice(0, 40)}${reply.length > 40 ? "…" : ""}`);
				})
				.catch((err: unknown) => {
					if (abort.signal.aborted) return;
					pushLog("error", (err as Error)?.message ?? "对话失败");
				})
				.finally(() => {
					if (turnSeqRef.current !== turnId) return;
					turnAbortRef.current = null;
					patientLineIdRef.current = null;
					setPatientReplying(false);
					void player?.waitIdle().then(() => {
						if (turnSeqRef.current !== turnId) return;
						settleStage();
					});
				});
		},
		[appendPatientChunk, character, pushLog, settleStage, streamChat],
	);

	const handleUserText = useCallback(
		(text: string) => {
			const trimmed = text.trim();
			if (!trimmed || !character) return;
			const arrivedAt = pendingUserAtRef.current ?? performance.now();
			pendingUserAtRef.current = null;
			setMetrics((m) => ({
				...m,
				sentenceMs: Math.round(performance.now() - arrivedAt),
			}));

			const intent = classifyUserText(trimmed);
			lineSeqRef.current += 1;
			const userLineId = lineSeqRef.current;
			setLines((prev) => [...prev, { id: userLineId, role: "user", text: trimmed, tag: intent }]);

			const before = emotionRef.current;
			const next = applyEmotionEffect(before, character, { intent, interrupted: interruptedRef.current });
			interruptedRef.current = false;
			emotionRef.current = next;
			setEmotion(next);
			setLabel(dominantLabel(next));
			const changed = EMOTION_DIMS.filter((dim) => Math.abs(next[dim] - before[dim]) >= 0.005);
			if (changed.length > 0) {
				pushLog(
					"emotion",
					changed
						.map((dim) => `${dim} ${next[dim] - before[dim] > 0 ? "+" : ""}${(next[dim] - before[dim]).toFixed(2)}`)
						.join(" · "),
				);
			}
			pushLog("user", `[${intent}] ${trimmed.slice(0, 40)}`);

			if (stageRef.current === "idle" || stageRef.current === "ended") {
				voiceRef.current.start();
				setDialed(true);
			}
			runTurn(trimmed);
		},
		[character, pushLog, runTurn],
	);

	const handleBargeIn = useCallback(() => {
		const player = playerRef.current;
		const at = performance.now();
		interruptedRef.current = true;
		// 递增轮次序号：SSE 后续帧、TTS 后续句子都不再属于当前这轮。
		turnSeqRef.current += 1;
		turnAbortRef.current?.abort();
		turnAbortRef.current = null;
		player?.stop();
		setSpeaking(false);
		setPatientReplying(false);
		setMetrics((m) => ({ ...m, stopMs: Math.round(performance.now() - at) }));
		pushLog("tts", `打断停播 ${Math.round(performance.now() - at)}ms`);
		setLines((prev) => {
			const last = prev[prev.length - 1];
			if (last?.role !== "patient" || last.interrupted) return prev;
			// 打断只标记状态，不吞掉已生成/未念完的文本：记录区要能复盘她原本要说什么。
			return [
				...prev.slice(0, -1),
				{ ...last, interrupted: true, text: last.text || "（未收到回复内容）" },
			];
		});
		settleStage();
	}, [pushLog, settleStage]);

	const voice = voiceHook({
		onSend: (text) => {
			if (isEchoLike(text)) {
				pushLog("system", "忽略患者语音回录");
				return;
			}
			handleUserText(text);
		},
		patientReplying,
		patientSpeaking: speaking,
		continuous: true,
		silenceMs: 900,
		recordId: 0,
		token,
		onBargeIn: handleBargeIn,
		echoLevel: ttsEchoLevel,
		bargeInGate: "asr",
		bargeInGuard: ttsEchoGuard,
		bargeInMinChars: 2,
	});

	const voiceRef = useRef(voice);
	voiceRef.current = voice;

	const liveUserText = voice.transcript;
	useEffect(() => {
		if (liveUserText) pendingUserAtRef.current ??= performance.now();
	}, [liveUserText]);

	const startCall = useCallback(() => {
		const player = playerRef.current;
		if (!character || !player) return;
		const callSeq = ++callSeqRef.current;
		const initial = character.initial;
		emotionRef.current = initial;
		setEmotion(initial);
		setLabel(dominantLabel(initial));
		setLines([]);
		setLog([]);
		historyRef.current = [];
		recentTtsRef.current = [];
		lastPatientTextRef.current = "";
		lastPatientAtRef.current = 0;
		setDialed(true);
		setMetrics({ firstBlockMs: null, stopMs: null, sentenceMs: null, firstTokenMs: null, voice: null, ttsEmotion: null });
		stageRef.current = "greeting";
		setStage("greeting");
		pushLog("system", `拨号：${character.name}`);
		void player.prime();
		voice.start();
		const opener = openingLine(character);
		setPatientReplying(true);
		setLines([{ id: ++lineSeqRef.current, role: "patient", text: opener }]);
		const finishGreeting = () => {
			if (callSeqRef.current !== callSeq) return;
			setPatientReplying(false);
			settleStage();
		};
		const connectTone = player.playConnectTone?.();
		if (!connectTone) {
			void speakWhole(opener).finally(finishGreeting);
		} else {
			// 先播已知频率的接通音，让回声门在开场白之前拿到干净的延迟/增益样本。
			void connectTone
				.then(() => (callSeqRef.current === callSeq ? speakWhole(opener) : undefined))
				.finally(finishGreeting);
		}
	}, [character, pushLog, settleStage, speakWhole, voice]);

	const stopCall = useCallback(() => {
		callSeqRef.current += 1;
		turnSeqRef.current += 1;
		turnAbortRef.current?.abort();
		turnAbortRef.current = null;
		playerRef.current?.stop();
		voice.stop();
		setSpeaking(false);
		setPatientReplying(false);
		recentTtsRef.current = [];
		lastPatientTextRef.current = "";
		lastPatientAtRef.current = 0;
		stageRef.current = "ended";
		setStage("ended");
		setDialed(false);
		pushLog("system", "通话已结束");
	}, [pushLog, voice]);

	const runQuickTest = useCallback(
		(kind: "greeting" | "interrupt" | "emotion") => {
			if (!character) return;
			if (kind === "interrupt") {
				// 长回复用例：后端 `test_mode=long_response` 给一段长台词，学生随即打断。
				lineSeqRef.current += 1;
				setLines((prev) => [
					...prev,
					{ id: lineSeqRef.current, role: "user", text: "你详细说说，从头讲。", tag: "question" },
				]);
				if (stageRef.current === "idle" || stageRef.current === "ended") {
					voice.start();
					setDialed(true);
				}
				runTurn("你详细说说，从头讲。", "long_response");
				return;
			}
			handleUserText(kind === "greeting" ? "你好呀，最近还好吗？" : "你现在心情怎么样？");
		},
		[character, handleUserText, runTurn, voice],
	);

	return {
		character,
		emotion,
		label,
		stage,
		lines,
		log,
		metrics,
		transcript: voice.transcript,
		voicePhase: voice.phase,
		speechActive: voice.speechActive,
		continuousArmed: voice.continuousArmed,
		continuousFailed: voice.continuousFailed,
		basicVoiceMode: voice.basicVoiceMode,
		voiceSupported: voice.supported,
		voiceNotice: voice.notice,
		draft,
		setDraft,
		speaking,
		ttsLevel,
		patientReplying,
		dialed,
		turnDetection: voice.continuousArmed && !voice.basicVoiceMode,
		startCall,
		stopCall,
		handleUserText,
		handleBargeIn,
		runQuickTest,
	};
}

type RecentTts = Array<{ norm: string; at: number }>;

/** 去掉空白与标点，只留下可用于相似度比较的字。 */
function normalizeSpeech(text: string): string {
	return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

/** 二元字组 Dice 相似度：容忍 ASR 少量增删字。 */
function similarSpeech(a: string, b: string): boolean {
	if (a.length < 4 || b.length < 4) return false;
	if (a.includes(b) || b.includes(a)) return true;
	const grams = (value: string) => {
		const set = new Set<string>();
		for (let i = 0; i < value.length - 1; i += 1) set.add(value.slice(i, i + 2));
		return set;
	};
	const ga = grams(a);
	const gb = grams(b);
	let hit = 0;
	for (const gram of ga) if (gb.has(gram)) hit += 1;
	return (2 * hit) / (ga.size + gb.size) >= 0.65;
}

function isTtsEcho(text: string, recent: RecentTts): boolean {
	const norm = normalizeSpeech(text);
	if (norm.length < 4) return false;
	const now = performance.now();
	return recent.some((item) => now - item.at < 7000 && similarSpeech(norm, item.norm));
}
