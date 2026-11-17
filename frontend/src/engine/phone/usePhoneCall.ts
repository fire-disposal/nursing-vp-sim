import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import useAuthStore from "@/stores/authStore";
import { useVoiceDialogue, type UseVoiceDialogueResult } from "@/hooks/useVoiceDialogue";
import { findCharacter, type PhoneCharacter } from "@/engine/phone/characters";
import { classifyUserText, openingLine } from "@/engine/phone/script";
import { streamDemoChat, trimHistory, type DemoHistoryMessage } from "@/engine/phone/chat";
import { EMOTION_DIMS, dominantLabel } from "@/engine/phone/emotion";
import { applyEmotionEffect } from "@/engine/phone/emotionEffect";
import { DemoTTSPlayer } from "@/engine/phone/ttsPlayer";
import {
	initialPhoneCallState,
	phoneCallReducer,
	type PhoneCallLine,
	type PhoneInterruptionSource,
} from "./callMachine";
import type { EmotionVector, PhoneEmotionLabel, PhoneLogEntry, PhoneStage } from "@/engine/phone/types";

export type { PhoneCallLine, PhoneInterruptionSource } from "./callMachine";

/**
 * 电话编排只有一个真相源：
 * - stage 只描述真实阶段，等待模型与播报分开；
 * - 用户文本只有最终提交才进入对话，ASR 中间结果永远是预览；
 * - 患者文本只有收到首个内容块才创建，空回复不会留下气泡；
 * - 历史与后端共用 user/assistant，当前用户消息随本轮请求发送；
 * - 回录只进入诊断日志，不进入用户消息、历史或打断原因。
 */

export interface UsePhoneCallOptions {
	characterId: string | null;
	voiceHook?: typeof useVoiceDialogue;
	playerFactory?: () => DemoTTSPlayer;
	streamChat?: typeof streamDemoChat;
}

export interface PhoneCallMetrics {
	firstBlockMs: number | null;
	stopMs: number | null;
	sentenceMs: number | null;
	firstTokenMs: number | null;
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
	transcript: string;
	voicePhase: UseVoiceDialogueResult["phase"];
	speechActive: boolean;
	continuousArmed: boolean;
	continuousFailed: boolean;
	basicVoiceMode: boolean;
	voiceSupported: boolean;
	voiceNotice: string | null;
	draft: string;
	setDraft: (value: string) => void;
	speaking: boolean;
	ttsLevel: number;
	patientReplying: boolean;
	dialed: boolean;
	startCall: () => void;
	stopCall: () => void;
	handleUserText: (text: string) => void;
	handleBargeIn: (reason?: PhoneInterruptionSource) => void;
	runQuickTest: (kind: "greeting" | "interrupt" | "emotion") => void;
}

interface ActiveTurn {
	id: number;
	userText: string;
	abort: AbortController;
	patientLineId: number | null;
	reply: string;
	startedAt: number;
	firstTokenAt: number | null;
}

const EMPTY: EmotionVector = { trust: 0, anxiety: 0, irritation: 0, cooperation: 0 };
const EMPTY_METRICS: PhoneCallMetrics = {
	firstBlockMs: null,
	stopMs: null,
	sentenceMs: null,
	firstTokenMs: null,
	voice: null,
	ttsEmotion: null,
};

export function usePhoneCall({
	characterId,
	voiceHook = useVoiceDialogue,
	playerFactory,
	streamChat = streamDemoChat,
}: UsePhoneCallOptions): UsePhoneCallResult {
	const character = useMemo(() => findCharacter(characterId), [characterId]);
	const token = useAuthStore((s) => s.token);
	const [call, dispatch] = useReducer(phoneCallReducer, initialPhoneCallState);
	const [emotion, setEmotion] = useState<EmotionVector>(() => character?.initial ?? EMPTY);
	const label = dominantLabel(emotion);
	const [log, setLog] = useState<PhoneLogEntry[]>([]);
	const [draft, setDraft] = useState("");
	const [speaking, setSpeaking] = useState(false);
	const [ttsLevel, setTtsLevel] = useState(0);
	const [dialed, setDialed] = useState(false);
	const [metrics, setMetrics] = useState<PhoneCallMetrics>(EMPTY_METRICS);

	const stageRef = useRef<PhoneStage>("idle");
	const emotionRef = useRef<EmotionVector>(character?.initial ?? EMPTY);
	const sessionIdRef = useRef(crypto.randomUUID());
	const historyRef = useRef<DemoHistoryMessage[]>([]);
	const activeTurnRef = useRef<ActiveTurn | null>(null);
	const openingLineIdRef = useRef<number | null>(null);
	const turnSeqRef = useRef(0);
	const callSeqRef = useRef(0);
	const ttsSeqRef = useRef(0);
	const lineSeqRef = useRef(0);
	const logSeqRef = useRef(0);
	const interruptedRef = useRef(false);
	const pendingUserAtRef = useRef<number | null>(null);
	const recentTtsRef = useRef<RecentTts>([]);
	const lastPatientTextRef = useRef("");
	const openingTextRef = useRef("");
	const voiceRef = useRef<UseVoiceDialogueResult | null>(null);

	const playerRef = useRef<DemoTTSPlayer | null>(null);
	if (!playerRef.current) {
		playerRef.current = playerFactory ? playerFactory() : new DemoTTSPlayer({ speaker: character?.speaker });
	}

	const setStage = useCallback((stage: PhoneStage) => {
		stageRef.current = stage;
		dispatch({ type: "stage", stage });
	}, []);

	const pushLog = useCallback((kind: PhoneLogEntry["kind"], text: string) => {
		logSeqRef.current += 1;
		setLog((prev) => [...prev.slice(-119), { id: logSeqRef.current, at: Date.now(), kind, text }]);
	}, []);

	const ttsEchoLevel = useCallback(() => playerRef.current?.outputLevel() ?? 0, []);
	const isEchoLike = useCallback((text: string) => {
		const norm = normalizeSpeech(text);
		const opening = normalizeSpeech(openingTextRef.current);
		if (opening && norm.length >= 2 && (opening.includes(norm) || similarSpeech(norm, opening, 0.45))) return true;
		if (isTtsEcho(text, recentTtsRef.current)) return true;
		if (!lastPatientTextRef.current) return false;
		const patient = normalizeSpeech(lastPatientTextRef.current);
		if (norm.length >= 2 && patient.includes(norm)) return true;
		return similarSpeech(norm, patient);
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
						...recentTtsRef.current.filter((item) => performance.now() - item.at < 30000),
						{ norm: normalizeSpeech(event.text), at: performance.now() },
					];
					break;
				case "fallback":
					pushLog("system", `TTS 服务不可用，已切换浏览器朗读：${event.reason}`);
					break;
				case "stopped":
					setSpeaking(false);
					break;
				case "error":
					pushLog("error", event.message);
					break;
				case "done":
					// done 表示文本合成队列结束，不代表扬声器已经静音；静音由 waitIdle/stopped 决定。
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
			activeTurnRef.current?.abort.abort();
			player?.dispose();
			playerRef.current = null;
		};
	}, []);

	useEffect(() => {
		callSeqRef.current += 1;
		turnSeqRef.current += 1;
		activeTurnRef.current?.abort.abort();
		activeTurnRef.current = null;
		const initial = character?.initial ?? EMPTY;
		emotionRef.current = initial;
		setEmotion(initial);
		stageRef.current = "idle";
		dispatch({ type: "reset" });
		setLog([]);
		setDialed(false);
		setMetrics(EMPTY_METRICS);
		historyRef.current = [];
		recentTtsRef.current = [];
		lastPatientTextRef.current = "";
		openingTextRef.current = "";
		openingLineIdRef.current = null;
		interruptedRef.current = false;
	}, [character]);

	const stopPatient = useCallback(
		(reason: PhoneInterruptionSource = "user") => {
			const at = performance.now();
			const turn = activeTurnRef.current;
			const lineId = turn?.patientLineId ?? (stageRef.current === "greeting" ? openingLineIdRef.current : null);
			turnSeqRef.current += 1;
			ttsSeqRef.current += 1;
			activeTurnRef.current = null;
			turn?.abort.abort();
			playerRef.current?.stop();
			setSpeaking(false);
			if (lineId !== null) dispatch({ type: "patient_stopped", id: lineId, by: reason });
			openingLineIdRef.current = null;
			if (reason === "user") interruptedRef.current = true;
			setMetrics((m) => ({ ...m, stopMs: Math.round(performance.now() - at) }));
			pushLog("tts", reason === "user" ? "识别到有效用户发言，停止患者播报" : "手动停止患者播报");
			setStage(reason === "user" ? "user_speaking" : "listening");
		},
		[pushLog, setStage],
	);

	const speakWhole = useCallback(
		async (text: string) => {
			const player = playerRef.current;
			if (!player) return;
			const seq = ++ttsSeqRef.current;
			player.setContext(dominantLabel(emotionRef.current), `phone-${characterId ?? "demo"}`);
			await player.speak(text);
			await player.finish();
			await player.waitIdle();
			if (ttsSeqRef.current === seq) setSpeaking(false);
		},
		[characterId],
	);

	const settleTurn = useCallback(
		(turn: ActiveTurn, hasReply: boolean) => {
			if (activeTurnRef.current?.id !== turn.id) return;
			if (!hasReply) {
				activeTurnRef.current = null;
				setSpeaking(false);
				setStage("listening");
				return;
			}
			void playerRef.current?.waitIdle().then(() => {
				if (activeTurnRef.current?.id !== turn.id || stageRef.current === "ended") return;
				activeTurnRef.current = null;
				setSpeaking(false);
				setStage("listening");
			});
		},
		[setStage],
	);

	const runTurn = useCallback(
		(text: string, testMode?: "long_response") => {
			if (!character) return;
			const turn: ActiveTurn = {
				id: ++turnSeqRef.current,
				userText: text,
				abort: new AbortController(),
				patientLineId: null,
				reply: "",
				startedAt: performance.now(),
				firstTokenAt: null,
			};
			activeTurnRef.current = turn;
			lastPatientTextRef.current = "";
			setStage("waiting_reply");
			const player = playerRef.current;
			player?.setContext(dominantLabel(emotionRef.current), `phone-${character.id}`);
			void streamChat(
				{
					character_id: character.id,
					session_id: sessionIdRef.current,
					history: trimHistory([...historyRef.current, { role: "user", content: text }]),
					emotion_state: dominantLabel(emotionRef.current),
					...(testMode ? { test_mode: testMode } : {}),
				},
				{
					signal: turn.abort.signal,
					onChunk: (chunk) => {
						if (activeTurnRef.current?.id !== turn.id || !chunk) return;
						if (turn.firstTokenAt === null) {
							turn.firstTokenAt = performance.now();
							setMetrics((m) => ({ ...m, firstTokenMs: Math.round(turn.firstTokenAt! - turn.startedAt) }));
							setStage("patient_speaking");
						}
						turn.patientLineId ??= ++lineSeqRef.current;
						turn.reply += chunk;
						lastPatientTextRef.current = turn.reply;
						dispatch({ type: "patient_chunk", id: turn.patientLineId, chunk });
						void player?.speak(chunk);
					},
					onError: (message) => {
						if (activeTurnRef.current?.id === turn.id) pushLog("error", message);
					},
					onDone: () => {
						if (activeTurnRef.current?.id === turn.id) void player?.finish();
					},
				},
			)
				.then((full) => {
					if (activeTurnRef.current?.id !== turn.id) return;
					const reply = (full || turn.reply).trim();
					if (reply) {
						if (turn.patientLineId !== null) dispatch({ type: "patient_done", id: turn.patientLineId });
						historyRef.current = trimHistory([
							...historyRef.current,
							{ role: "user", content: turn.userText },
							{ role: "assistant", content: reply },
						]);
						pushLog("patient", reply);
					} else {
						dispatch({ type: "patient_error", id: turn.patientLineId });
						pushLog("error", "对方没有返回可播放的文本");
					}
					settleTurn(turn, Boolean(reply));
				})
				.catch((err: unknown) => {
					if (turn.abort.signal.aborted || activeTurnRef.current?.id !== turn.id) return;
					dispatch({ type: "patient_error", id: turn.patientLineId });
					pushLog("error", (err as Error)?.message ?? "对话失败");
					settleTurn(turn, turn.patientLineId !== null);
				});
		},
		[character, pushLog, setStage, settleTurn, streamChat],
	);

	const handleUserText = useCallback(
		(text: string, testMode?: "long_response") => {
			const trimmed = text.trim();
			if (!trimmed || !character) return;
			openingTextRef.current = "";
			if (activeTurnRef.current || speaking) stopPatient("user");
			const arrivedAt = pendingUserAtRef.current ?? performance.now();
			pendingUserAtRef.current = null;
			setMetrics((m) => ({ ...m, sentenceMs: Math.round(performance.now() - arrivedAt) }));
			const intent = classifyUserText(trimmed);
			dispatch({
				type: "user",
				line: { id: ++lineSeqRef.current, role: "user", text: trimmed, state: "complete" },
			});

			const before = emotionRef.current;
			const next = applyEmotionEffect(before, character, { intent, interrupted: interruptedRef.current });
			interruptedRef.current = false;
			emotionRef.current = next;
			setEmotion(next);
			const changed = EMOTION_DIMS.filter((dim) => Math.abs(next[dim] - before[dim]) >= 0.005);
			if (changed.length > 0) {
				pushLog(
					"emotion",
					changed
						.map((dim) => `${dim} ${next[dim] - before[dim] > 0 ? "+" : ""}${(next[dim] - before[dim]).toFixed(2)}`)
						.join(" · "),
				);
			}
			pushLog("user", trimmed);
			if (stageRef.current === "idle" || stageRef.current === "ended") {
				voiceRef.current?.start();
				setDialed(true);
			}
			runTurn(trimmed, testMode);
		},
		[character, pushLog, runTurn, speaking, stopPatient],
	);

	const patientReplying = call.stage === "greeting" || call.stage === "waiting_reply" || call.stage === "patient_speaking";
	const voice = voiceHook({
		onSend: (text) => {
			if (isEchoLike(text)) {
				pushLog("system", "已拦截患者语音回录，不生成用户消息");
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
		onBargeIn: () => stopPatient("user"),
		echoLevel: ttsEchoLevel,
		bargeInGate: "asr",
		bargeInGuard: isEchoLike,
		bargeInMinChars: 2,
	});
	voiceRef.current = voice;
	const liveTranscript = isEchoLike(voice.transcript) ? "" : voice.transcript;

	useEffect(() => {
		if (liveTranscript.trim()) {
			pendingUserAtRef.current ??= performance.now();
			if (stageRef.current === "listening") setStage("user_speaking");
		} else if (stageRef.current === "user_speaking" && !activeTurnRef.current) {
			setStage("listening");
		}
	}, [liveTranscript, setStage]);

	const startCall = useCallback(() => {
		const player = playerRef.current;
		if (!character || !player) return;
		const callSeq = ++callSeqRef.current;
		turnSeqRef.current += 1;
		activeTurnRef.current?.abort.abort();
		activeTurnRef.current = null;
		const initial = character.initial;
		emotionRef.current = initial;
		setEmotion(initial);
		setLog([]);
		historyRef.current = [];
		recentTtsRef.current = [];
		setDialed(true);
		setMetrics(EMPTY_METRICS);
		interruptedRef.current = false;
		pushLog("system", `接通：${character.name}`);
		const opener = openingLine(character);
		lastPatientTextRef.current = opener;
		openingTextRef.current = opener;
		openingLineIdRef.current = ++lineSeqRef.current;
		stageRef.current = "greeting";
		dispatch({
			type: "opening",
			line: { id: openingLineIdRef.current, role: "patient", text: opener, state: "complete" },
		});
		voice.start();
		void (async () => {
			await player.prime();
			await player.playConnectTone?.();
			if (callSeqRef.current !== callSeq || stageRef.current !== "greeting") return;
			await speakWhole(opener);
			if (callSeqRef.current !== callSeq || stageRef.current !== "greeting") return;
			openingLineIdRef.current = null;
			setStage("listening");
		})().catch((err: unknown) => {
			if (callSeqRef.current !== callSeq) return;
			pushLog("error", (err as Error)?.message ?? "开场白播放失败");
			setStage("listening");
		});
	}, [character, pushLog, setStage, speakWhole, voice]);

	const stopCall = useCallback(() => {
		callSeqRef.current += 1;
		turnSeqRef.current += 1;
		ttsSeqRef.current += 1;
		activeTurnRef.current?.abort.abort();
		activeTurnRef.current = null;
		openingLineIdRef.current = null;
		playerRef.current?.stop();
		voice.stop();
		setSpeaking(false);
		recentTtsRef.current = [];
		lastPatientTextRef.current = "";
		openingTextRef.current = "";
		setStage("ended");
		setDialed(false);
		pushLog("system", "通话已结束");
	}, [pushLog, setStage, voice]);

	const runQuickTest = useCallback(
		(kind: "greeting" | "interrupt" | "emotion") => {
			if (kind === "interrupt") handleUserText("你详细说说，从头讲。", "long_response");
			else handleUserText(kind === "greeting" ? "你好呀，最近还好吗？" : "你现在心情怎么样？");
		},
		[handleUserText],
	);

	return {
		character,
		emotion,
		label,
		stage: call.stage,
		lines: call.lines,
		log,
		metrics,
		transcript: liveTranscript,
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
		startCall,
		stopCall,
		handleUserText: (text: string) => handleUserText(text),
		handleBargeIn: stopPatient,
		runQuickTest,
	};
}

type RecentTts = Array<{ norm: string; at: number }>;

function normalizeSpeech(text: string): string {
	return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function similarSpeech(a: string, b: string, threshold = 0.65): boolean {
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
	return (2 * hit) / (ga.size + gb.size) >= threshold;
}

function isTtsEcho(text: string, recent: RecentTts): boolean {
	const norm = normalizeSpeech(text);
	if (norm.length < 2) return false;
	const now = performance.now();
	return recent.some(
		(item) => now - item.at < 30000 && (item.norm.includes(norm) || similarSpeech(norm, item.norm)),
	);
}
