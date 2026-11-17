import { useCallback, useEffect, useRef, useState } from "react";
import useAuthStore from "@/stores/authStore";
import { useVoiceDialogue } from "@/hooks/useVoiceDialogue";
import { DEMO_TTS_PATH } from "@/engine/phone/ttsPlayer";
import { PcmStreamPlayer } from "@/engine/tts/pcm-player";
import { accessHeaders } from "@/utils/accessContext";
import { prepareAec3, type CancellerStats } from "./aec3";
import { reportAudioTelemetry } from "./audioTelemetry";
import { WaveRing } from "./waveRing";

export interface AcousticWaveHistory {
	tts: WaveRing;
	mic: WaveRing;
	clean: WaveRing;
}

export interface UseAcousticWorkbenchOptions {
	recordId?: number;
	initialSpeaker?: string;
	initialText?: string;
	characterId?: string;
}

export interface UseAcousticWorkbenchResult {
	aec3Stats: CancellerStats | null;
	recognized: string;
	transcript: string;
	running: boolean;
	step: string;
	error: string | null;
	ttsBusy: boolean;
	voiceArmed: boolean;
	voiceNotice: string | null;
	speaker: string;
	setSpeaker: (value: string) => void;
	text: string;
	setText: (value: string) => void;
	spanSeconds: string;
	setSpanSeconds: (value: string) => void;
	waves: AcousticWaveHistory;
	startCalibration: () => Promise<void>;
	stop: () => void;
	startMonitor: () => void;
	stopMonitor: () => void;
	playTts: () => Promise<void>;
}

function createWaves(): AcousticWaveHistory {
	return { tts: new WaveRing(20), mic: new WaveRing(20), clean: new WaveRing(20) };
}

/**
 * 声学工作台控制器：AEC3 + TTS + ASR + 三路真实 PCM。
 * 不依赖面板组件，后续人物卡直接复用。
 */
export function useAcousticWorkbench({
	recordId = 0,
	initialSpeaker = "",
	initialText = "你好，我正在测试这条语音链路。",
	characterId,
}: UseAcousticWorkbenchOptions = {}): UseAcousticWorkbenchResult {
	const token = useAuthStore((s) => s.token);
	const [aec3Stats, setAec3Stats] = useState<CancellerStats | null>(null);
	const aec3AtRef = useRef(0);
	const latestStatsRef = useRef<CancellerStats | null>(null);
	const sessionIdRef = useRef(crypto.randomUUID());
	const [recognized, setRecognized] = useState("");
	const [running, setRunning] = useState(false);
	const [step, setStep] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [speaker, setSpeaker] = useState(initialSpeaker);
	const [text, setText] = useState(initialText);
	const [ttsBusy, setTtsBusy] = useState(false);
	const [spanSeconds, setSpanSeconds] = useState("10");

	const playerRef = useRef<PcmStreamPlayer | null>(null);
	const waveRef = useRef<AcousticWaveHistory>(createWaves());
	const runRef = useRef(0);
	const readyRef = useRef<(() => void) | null>(null);

	const onPcmFrame = useCallback(
		({ mic, clean, endMs }: { mic: Int16Array; clean: Int16Array; endMs: number }) => {
			const player = playerRef.current;
			if (!player || mic.length === 0) return;
			const reference = player.readReference(endMs - mic.length / 16, mic.length);
			const current = waveRef.current;
			current.tts.push(reference);
			current.mic.push(mic, 1 / 32768);
			current.clean.push(clean, 1 / 32768);
		},
		[],
	);

	const onAec3Stats = useCallback((next: CancellerStats) => {
		const now = performance.now();
		latestStatsRef.current = next;
		if (now - aec3AtRef.current < 200) return;
		aec3AtRef.current = now;
		setAec3Stats(next);
	}, []);

	const onVoiceReady = useCallback(() => {
		readyRef.current?.();
		readyRef.current = null;
	}, []);

	const voice = useVoiceDialogue({
		onSend: setRecognized,
		patientReplying: false,
		continuous: true,
		vad: false,
		aec3: true,
		silenceMs: 900,
		recordId,
		token,
		echoReference: (startMs, length) => playerRef.current?.readReference(startMs, length) ?? new Float32Array(length),
		onPcmFrame,
		onAec3Stats,
		onVoiceReady,
	});

	const voiceStopRef = useRef(voice.stop);
	voiceStopRef.current = voice.stop;

	const stop = useCallback(() => {
		runRef.current += 1;
		voiceStopRef.current();
		playerRef.current?.dispose();
		playerRef.current = null;
		setRunning(false);
		setStep("");
		waveRef.current = createWaves();
	}, []);

	// 每 2 秒上报一次最新 AEC3 统计；不随统计更新频率触发请求。
	useEffect(() => {
		if (!token) return;
		const timer = window.setInterval(() => {
			const stats = latestStatsRef.current;
			if (!stats) return;
			void reportAudioTelemetry({
				session_id: sessionIdRef.current,
				mode: "workbench",
				character_id: characterId ?? null,
				delay_ms: stats.delayMs,
				erle_db: stats.erleDb,
				erl_db: stats.erlDb,
				divergent_filter_fraction: stats.divergentFilterFraction,
				voice: stats.voice,
				reference_short: stats.referenceShort,
				reference_dropped: stats.referenceDropped,
				non_finite_samples: stats.nonFiniteSamples,
				errors: stats.errors,
			});
		}, 2000);
		return () => window.clearInterval(timer);
	}, [characterId, token]);

	// AEC3 是 525KB WASM，空闲预热，避免第一次点击再编译造成卡顿。
	useEffect(() => {
		const timer = window.setTimeout(() => {
			void prepareAec3().catch(() => undefined);
		}, 500);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => () => {
		voiceStopRef.current();
		playerRef.current?.dispose();
	}, []);

	const startCalibration = useCallback(async () => {
		stop();
		const run = runRef.current;
		setAec3Stats(null);
		setError(null);
		setRunning(true);
		setStep("加载 AEC3…");
		try {
			await prepareAec3();
			setStep("请求麦克风与 ASR…");
			const player = new PcmStreamPlayer();
			playerRef.current = player;
			await player.prime();
			const ready = new Promise<void>((resolve) => {
				readyRef.current = resolve;
			});
			voice.start();
			await withTimeout(ready, 3000, "麦克风或 ASR 未就绪");
			setStep("AEC3 运行中，播放 TTS 测试");
			setRunning(false);
		} catch (err) {
			if (runRef.current !== run) return;
			runRef.current += 1;
			setRunning(false);
			setStep("");
			setError((err as Error)?.message ?? "AEC3 启动失败");
			voiceStopRef.current();
		}
	}, [stop, voice]);

	const playTts = useCallback(async () => {
		if (!text.trim() || ttsBusy) return;
		setTtsBusy(true);
		setError(null);
		try {
			const player = playerRef.current ?? new PcmStreamPlayer();
			playerRef.current = player;
			await player.prime();
			const response = await fetch(DEMO_TTS_PATH, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...accessHeaders() },
				body: JSON.stringify({ text: text.trim(), emotion_state: "neutral", section_id: "acoustic-lab", speaker }),
			});
			if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
			if (!response.body) throw new Error("TTS 没有返回音频");
			await player.playStream(response.body);
		} catch (err) {
			setError((err as Error)?.message ?? "TTS 播放失败");
		} finally {
			setTtsBusy(false);
		}
	}, [speaker, text, ttsBusy]);

	return {
		aec3Stats,
		recognized,
		transcript: voice.transcript,
		running,
		step,
		error,
		ttsBusy,
		voiceArmed: voice.continuousArmed,
		voiceNotice: voice.notice,
		speaker,
		setSpeaker,
		text,
		setText,
		spanSeconds,
		setSpanSeconds,
		waves: waveRef.current,
		startCalibration,
		stop,
		startMonitor: voice.start,
		stopMonitor: voice.stop,
		playTts,
	};
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
	]);
}
