import { useCallback, useEffect, useRef, useState } from "react";
import useAuthStore from "@/stores/authStore";
import { useVoiceDialogue } from "@/hooks/useVoiceDialogue";
import { DEMO_TTS_PATH } from "@/engine/phone/ttsPlayer";
import { PcmStreamPlayer } from "@/engine/tts/pcm-player";
import { accessHeaders } from "@/utils/accessContext";
import type { EchoCalibrationResult, EchoSuppressionResult } from "./mic";
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
}

export interface UseAcousticWorkbenchResult {
	calibration: EchoCalibrationResult | null;
	suppression: EchoSuppressionResult | null;
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
	waveVersion: number;
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
 * 声学工作台控制器：不依赖任何面板组件。
 * 后续人物卡可直接复用本 hook，只替换展示层。
 */
export function useAcousticWorkbench({
	recordId = 0,
	initialSpeaker = "",
	initialText = "你好，我正在测试这条语音链路。",
}: UseAcousticWorkbenchOptions = {}): UseAcousticWorkbenchResult {
	const token = useAuthStore((s) => s.token);
	const [calibration, setCalibration] = useState<EchoCalibrationResult | null>(null);
	const [suppression, setSuppression] = useState<EchoSuppressionResult | null>(null);
	const [recognized, setRecognized] = useState("");
	const [running, setRunning] = useState(false);
	const [step, setStep] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [speaker, setSpeaker] = useState(initialSpeaker);
	const [text, setText] = useState(initialText);
	const [ttsBusy, setTtsBusy] = useState(false);
	const [spanSeconds, setSpanSeconds] = useState("10");
	const [waveVersion, setWaveVersion] = useState(0);

	const playerRef = useRef<PcmStreamPlayer | null>(null);
	const calibrationRef = useRef<EchoCalibrationResult | null>(null);
	const waveRef = useRef<AcousticWaveHistory>(createWaves());
	const waveRenderTimerRef = useRef<number | null>(null);
	const suppressionAtRef = useRef(0);
	const runRef = useRef(0);
	const readyRef = useRef<(() => void) | null>(null);
	const calibrationReadyRef = useRef<((result: EchoCalibrationResult) => void) | null>(null);

	const scheduleWaveRender = useCallback(() => {
		if (waveRenderTimerRef.current !== null) return;
		waveRenderTimerRef.current = window.setTimeout(() => {
			waveRenderTimerRef.current = null;
			setWaveVersion((version) => version + 1);
		}, 100);
	}, []);

	const onPcmFrame = useCallback(
		({ mic, clean, endMs }: { mic: Int16Array; clean: Int16Array; endMs: number }) => {
			const player = playerRef.current;
			if (!player || mic.length === 0) return;
			const delay = calibrationRef.current?.status === "success" ? calibrationRef.current.delayMs : 0;
			const referenceStart = endMs - mic.length / 16 - delay;
			const actual = player.readReference(referenceStart, mic.length);
			const ideal = idealMarkerReference(referenceStart, mic.length, player.markerOnsets());
			const reference = new Float32Array(mic.length);
			for (let i = 0; i < mic.length; i += 1) reference[i] = ideal[i] !== 0 ? (ideal[i] ?? 0) : (actual[i] ?? 0);
			const current = waveRef.current;
			current.tts.push(reference);
			current.mic.push(mic, 1 / 32768);
			current.clean.push(clean, 1 / 32768);
			scheduleWaveRender();
		},
		[scheduleWaveRender],
	);

	const onEchoCalibration = useCallback((next: EchoCalibrationResult) => {
		calibrationRef.current = next;
		setCalibration(next);
		setRunning(false);
		setStep("");
		calibrationReadyRef.current?.(next);
		calibrationReadyRef.current = null;
	}, []);

	const onEchoSuppression = useCallback((next: EchoSuppressionResult) => {
		const now = performance.now();
		if (now - suppressionAtRef.current < 200) return;
		suppressionAtRef.current = now;
		setSuppression(next);
	}, []);

	const onVoiceReady = useCallback(() => {
		readyRef.current?.();
		readyRef.current = null;
	}, []);

	const voice = useVoiceDialogue({
		onSend: setRecognized,
		patientReplying: false,
		continuous: true,
		silenceMs: 900,
		recordId,
		token,
		echoLevel: () => playerRef.current?.outputLevel() ?? 0,
		echoReference: (startMs, length) => playerRef.current?.readReference(startMs, length) ?? new Float32Array(length),
		markerOnsets: () => playerRef.current?.markerOnsets() ?? [],
		onEchoSuppression,
		onPcmFrame,
		onEchoCalibration,
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
		if (waveRenderTimerRef.current !== null) window.clearTimeout(waveRenderTimerRef.current);
		waveRenderTimerRef.current = null;
		setWaveVersion((version) => version + 1);
	}, []);

	useEffect(() => () => {
		if (waveRenderTimerRef.current !== null) window.clearTimeout(waveRenderTimerRef.current);
		voiceStopRef.current();
		playerRef.current?.dispose();
	}, []);

	const startCalibration = useCallback(async () => {
		stop();
		const run = runRef.current;
		setCalibration(null);
		calibrationRef.current = null;
		setError(null);
		setRunning(true);
		setStep("请求麦克风与 ASR…");
		try {
			const player = new PcmStreamPlayer();
			playerRef.current = player;
			await player.prime();
			const ready = new Promise<void>((resolve) => {
				readyRef.current = resolve;
			});
			const calibrated = new Promise<void>((resolve) => {
				calibrationReadyRef.current = () => resolve();
			});
			voice.start();
			await withTimeout(ready, 3000, "麦克风或 ASR 未就绪");
			setStep("播放三次滴声…");
			voice.beginEchoCalibration();
			await withTimeout(player.playConnectTone(), 2000, "校准音播放超时");
			setStep("分析起音时间差…");
			await withTimeout(calibrated, 2000, "未收到校准结果");
		} catch (err) {
			if (runRef.current !== run) return;
			runRef.current += 1;
			setRunning(false);
			setStep("");
			setError((err as Error)?.message ?? "校准失败");
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
		calibration,
		suppression,
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
		waveVersion,
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

function idealMarkerReference(startMs: number, length: number, onsets: number[]): Float32Array {
	const output = new Float32Array(length);
	for (let i = 0; i < length; i += 1) {
		const time = startMs + i / 16;
		for (const onset of onsets) {
			if (time >= onset && time < onset + 120) {
				output[i] = Math.sin((2 * Math.PI * 1000 * (time - onset)) / 1000) * 0.55;
				break;
			}
		}
	}
	return output;
}
