import { Badge, Button, Card, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconPlayerPlay, IconPlayerStop, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PHONE_CHARACTERS } from "@/engine/phone/characters";
import { DEMO_TTS_PATH } from "@/engine/phone/ttsPlayer";
import { PcmStreamPlayer } from "@/engine/tts/pcm-player";
import { useVoiceDialogue } from "@/hooks/useVoiceDialogue";
import useAuthStore from "@/stores/authStore";
import { accessHeaders } from "@/utils/accessContext";
import AcousticWaveform from "./AcousticWaveform";
import { WaveRing } from "./waveRing";
import type { EchoCalibrationResult, EchoSuppressionResult } from "@/engine/audio/mic";
import "./AcousticLabPanel.css";

interface WaveHistory {
	tts: WaveRing;
	mic: WaveRing;
	clean: WaveRing;
}

function createWaves(): WaveHistory {
	return { tts: new WaveRing(20), mic: new WaveRing(20), clean: new WaveRing(20) };
}

/** 实战声学面板：校准、TTS、ASR 与三路真实 PCM 波形共用一条链。 */
export default function AcousticLabPanel() {
	const token = useAuthStore((s) => s.token);
	const [result, setResult] = useState<EchoCalibrationResult | null>(null);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [speaker, setSpeaker] = useState(PHONE_CHARACTERS[2]?.speaker ?? PHONE_CHARACTERS[0]?.speaker ?? "");
	const [text, setText] = useState("你好，我正在测试这条语音链路。");
	const [ttsBusy, setTtsBusy] = useState(false);
	const [recognized, setRecognized] = useState("");
	const [suppression, setSuppression] = useState<EchoSuppressionResult | null>(null);
	const suppressionAtRef = useRef(0);
	const playerRef = useRef<PcmStreamPlayer | null>(null);
	const resultRef = useRef<EchoCalibrationResult | null>(null);
	const waveRef = useRef<WaveHistory>(createWaves());
	const waveRenderTimerRef = useRef<number | null>(null);
	const [waveVersion, setWaveVersion] = useState(0);
	const [spanSeconds, setSpanSeconds] = useState("10");
	const runRef = useRef(0);
	const readyRef = useRef<(() => void) | null>(null);
	const calibrationRef = useRef<((result: EchoCalibrationResult) => void) | null>(null);

	const scheduleWaveRender = useCallback(() => {
		if (waveRenderTimerRef.current !== null) return;
		waveRenderTimerRef.current = window.setTimeout(() => {
			waveRenderTimerRef.current = null;
			setWaveVersion((version) => version + 1);
		}, 100);
	}, []);

	const onPcmFrame = useCallback(({ mic, clean, endMs }: { mic: Int16Array; clean: Int16Array; endMs: number }) => {
		const player = playerRef.current;
		if (!player || mic.length === 0) return;
		const calibration = resultRef.current;
		const delay = calibration?.status === "success" ? calibration.delayMs : 0;
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
	}, [scheduleWaveRender]);

	const onEchoCalibration = useCallback((next: EchoCalibrationResult) => {
		resultRef.current = next;
		setResult(next);
		setRunning(false);
		calibrationRef.current?.(next);
		calibrationRef.current = null;
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
		recordId: 0,
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
		voice.stop();
		playerRef.current?.dispose();
		playerRef.current = null;
		setRunning(false);
		waveRef.current = createWaves();
		if (waveRenderTimerRef.current !== null) window.clearTimeout(waveRenderTimerRef.current);
		waveRenderTimerRef.current = null;
		setWaveVersion((version) => version + 1);
	}, [voice]);

	useEffect(() => () => {
		if (waveRenderTimerRef.current !== null) window.clearTimeout(waveRenderTimerRef.current);
		voiceStopRef.current();
		playerRef.current?.dispose();
	}, []);

	const startCalibration = async () => {
		stop();
		const run = runRef.current;
		setResult(null);
		resultRef.current = null;
		setError(null);
		setRunning(true);
		try {
			const player = new PcmStreamPlayer();
			playerRef.current = player;
			await player.prime();
			const ready = new Promise<void>((resolve) => {
				readyRef.current = resolve;
			});
			const calibrated = new Promise<void>((resolve) => {
				calibrationRef.current = () => resolve();
			});
			voice.start();
			await Promise.race([
				ready,
				new Promise<void>((_, reject) => setTimeout(() => reject(new Error("麦克风未就绪")), 5000)),
			]);
			voice.beginEchoCalibration();
			await player.playConnectTone();
			await calibrated;
		} catch (err) {
			if (runRef.current !== run) return;
			setRunning(false);
			setError((err as Error)?.message ?? "校准失败");
		}
	};

	const playTts = async () => {
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
	};

	return (
		<Card withBorder radius="md" padding="md" data-testid="acoustic-lab">
			<Stack gap="md">
				<Group justify="space-between" wrap="wrap">
					<Stack gap={2}>
						<Text fw={600}>声学工作面板</Text>
						<Text size="sm" c="dimmed">直接测试校准、TTS、ASR 与反相补偿。</Text>
					</Stack>
					<Badge color={result?.status === "success" ? "green" : result?.status === "failed" || error ? "red" : running ? "yellow" : "gray"}>
						{result?.status === "success" ? `匹配成功 ${result.delayMs}ms` : result?.status === "failed" || error ? "匹配失败" : running ? "校准中" : "未校准"}
					</Badge>
				</Group>

				<div className="acoustic-lab-layout">
					<Stack gap="sm" className="acoustic-lab-controls">
						<Group gap="xs">
							<Button size="xs" leftSection={<IconRefresh size={14} />} onClick={() => void startCalibration()} loading={running}>
								开始校准
							</Button>
							<Button size="xs" variant="subtle" color="gray" leftSection={<IconPlayerStop size={14} />} onClick={stop}>
								停止
							</Button>
						</Group>
						{result && (
							<Text size="xs" c="dimmed">
								延迟 {result.delayMs}ms；增益 {result.gain?.toFixed(3) ?? "—"}；特征匹配度 {result.score?.toFixed(2) ?? "—"}
							</Text>
						)}
						{result?.status === "failed" && (
							<Text size="xs" c="red">
								{calibrationReason(result.reason)}；参考起音 {result.refOnsets?.length ?? 0} 次，麦克风起音 {result.micOnsets?.length ?? 0} 次，间隔误差 {result.errorMs ?? "—"}ms
							</Text>
						)}
						{suppression && (
							<Text size="xs" c={suppression.reductionDb > 6 ? "teal" : "dimmed"}>
								反相抵消：麦克风 {db(suppression.micLevel)} → 残留 {db(suppression.cleanLevel)}，降低 {suppression.reductionDb.toFixed(1)}dB，极性 {suppression.polarity > 0 ? "反相" : "同相"}
							</Text>
						)}

						<Text size="sm" fw={600}>TTS 播放</Text>
						<TextInput value={text} onChange={(event) => setText(event.currentTarget.value)} aria-label="TTS 测试文本" />
						<Group gap="xs" align="flex-end" wrap="nowrap">
							<Select
								style={{ flex: 1 }}
								value={speaker}
								onChange={(value) => value && setSpeaker(value)}
								data={PHONE_CHARACTERS.map((character) => ({ value: character.speaker, label: `${character.name} ${character.voice}` }))}
								aria-label="TTS 音色"
							/>
							<Button size="xs" leftSection={<IconPlayerPlay size={14} />} onClick={() => void playTts()} loading={ttsBusy} disabled={!text.trim()}>
								播放
							</Button>
						</Group>

						<Text size="sm" fw={600}>ASR 识别</Text>
						<Group gap="xs">
							{voice.continuousArmed ? (
								<Button size="xs" color="red" variant="light" onClick={() => voice.stop()}>
									停止识别
								</Button>
							) : (
								<Button size="xs" onClick={() => voice.start()}>开始识别</Button>
							)}
						</Group>
						{voice.transcript && <Text size="sm" c="dimmed">实时：{voice.transcript}</Text>}
						{recognized && <Text size="sm">最终：{recognized}</Text>}
						{(error || voice.notice) && <Text size="sm" c="red">{error ?? voice.notice}</Text>}
					</Stack>

					<Stack gap="sm" className="acoustic-waveforms">
						<Group justify="space-between" gap="sm">
							<Group gap="xs">
								<Text size="sm" fw={600}>实时波形</Text>
								<Badge size="xs" variant="light" color={voice.continuousArmed ? "teal" : "gray"}>
									{voice.continuousArmed ? "收音持续中" : "未收音"}
								</Badge>
								<Button size="compact-xs" variant="subtle" onClick={voice.continuousArmed ? () => voice.stop() : () => voice.start()}>
									{voice.continuousArmed ? "停止监测" : "开始监测"}
								</Button>
							</Group>
							<Select
								size="xs"
								value={spanSeconds}
								onChange={(value) => value && setSpanSeconds(value)}
								data={[
									{ value: "5", label: "5 秒" },
									{ value: "10", label: "10 秒" },
									{ value: "20", label: "20 秒" },
								]}
								aria-label="波形时间窗"
								w={92}
							/>
						</Group>
						<AcousticWaveform title="TTS 延迟参考" data={waveRef.current.tts} color="var(--mantine-color-indigo-6)" seconds={Number(spanSeconds)} version={waveVersion} />
						<AcousticWaveform title="麦克风收音" data={waveRef.current.mic} color="var(--mantine-color-orange-7)" seconds={Number(spanSeconds)} version={waveVersion} />
						<AcousticWaveform title="反相补偿后" data={waveRef.current.clean} color="var(--mantine-color-teal-7)" seconds={Number(spanSeconds)} version={waveVersion} />
					</Stack>
				</div>
			</Stack>
		</Card>
	);
}

function db(level: number): string {
	return `${(20 * Math.log10(Math.max(level, 1e-6))).toFixed(1)} dBFS`;
}

function calibrationReason(reason: EchoCalibrationResult["reason"]): string {
	switch (reason) {
		case "no_samples":
			return "校准期没有收到足够的麦克风帧";
		case "no_reference":
			return "播放器没有产出三次参考起音";
		case "no_mic_onsets":
			return "麦克风没有检测到三次滴声起音";
		case "interval_mismatch":
			return "三次滴声的起音间隔不匹配";
		case "low_gain":
			return "滴声起音匹配，但回授增益不在合理范围";
		default:
			return "声学特征匹配失败";
	}
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
