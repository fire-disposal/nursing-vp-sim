import { Badge, Button, Card, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconPlayerPlay, IconPlayerStop, IconRefresh } from "@tabler/icons-react";
import { PHONE_CHARACTERS } from "@/engine/phone/characters";
import { useAcousticWorkbench } from "@/engine/audio/useAcousticWorkbench";
import AcousticWaveform from "./AcousticWaveform";
import type { EchoCalibrationResult } from "@/engine/audio/mic";
import "./AcousticLabPanel.css";

/** 测试外壳；实际采集、校准、TTS、ASR 与反相逻辑都在 useAcousticWorkbench。 */
export default function AcousticLabPanel() {
	const lab = useAcousticWorkbench({
		initialSpeaker: PHONE_CHARACTERS[2]?.speaker ?? PHONE_CHARACTERS[0]?.speaker ?? "",
	});

	return (
		<Card withBorder radius="md" padding="md" data-testid="acoustic-lab">
			<Stack gap="md">
				<Group justify="space-between" wrap="wrap">
					<Stack gap={2}>
						<Text fw={600}>声学工作面板</Text>
						<Text size="sm" c="dimmed">直接测试校准、TTS、ASR 与反相补偿。</Text>
					</Stack>
					<Badge color={lab.error ? "red" : lab.aec3Stats?.delayMs != null ? "green" : lab.running ? "yellow" : "gray"}>
						{lab.error ? "AEC3 失败" : lab.aec3Stats?.delayMs != null ? `AEC3 ${lab.aec3Stats.delayMs}ms / ERLE ${lab.aec3Stats.erleDb?.toFixed(1) ?? "—"}dB` : lab.running ? "AEC3 启动中" : "AEC3 待机"}
					</Badge>
				</Group>

				<div className="acoustic-lab-layout">
					<Stack gap="sm" className="acoustic-lab-controls">
						<Group gap="xs" align="center">
							<Button size="xs" leftSection={<IconRefresh size={14} />} onClick={() => void lab.startCalibration()} loading={lab.running}>
								启动 AEC3
							</Button>
							<Button size="xs" variant="subtle" color="gray" leftSection={<IconPlayerStop size={14} />} onClick={lab.stop}>
								停止
							</Button>
							{lab.running && lab.step && <Text size="xs" c="dimmed">{lab.step}</Text>}
						</Group>
						{lab.calibration && (
							<Text size="xs" c="dimmed">
								延迟 {lab.calibration.delayMs}ms；增益 {lab.calibration.gain?.toFixed(3) ?? "—"}；特征匹配度 {lab.calibration.score?.toFixed(2) ?? "—"}
							</Text>
						)}
						{lab.calibration?.status === "failed" && (
							<Text size="xs" c="red">
								{calibrationReason(lab.calibration.reason)}；参考起音 {lab.calibration.refOnsets?.length ?? 0} 次，麦克风起音 {lab.calibration.micOnsets?.length ?? 0} 次，间隔误差 {lab.calibration.errorMs ?? "—"}ms
							</Text>
						)}
						{lab.aec3Stats && (
							<Text size="xs" c={(lab.aec3Stats.erleDb ?? 0) > 6 ? "teal" : "dimmed"}>
								AEC3：延迟 {lab.aec3Stats.delayMs ?? "—"}ms；ERLE {lab.aec3Stats.erleDb?.toFixed(1) ?? "—"}dB；参考缺失 {lab.aec3Stats.referenceShort}；参考丢弃 {lab.aec3Stats.referenceDropped}
							</Text>
						)}

						<Text size="sm" fw={600}>TTS 播放</Text>
						<TextInput value={lab.text} onChange={(event) => lab.setText(event.currentTarget.value)} aria-label="TTS 测试文本" />
						<Group gap="xs" align="flex-end" wrap="nowrap">
							<Select
								style={{ flex: 1 }}
								value={lab.speaker}
								onChange={(value) => value && lab.setSpeaker(value)}
								data={PHONE_CHARACTERS.map((character) => ({ value: character.speaker, label: `${character.name} ${character.voice}` }))}
								aria-label="TTS 音色"
							/>
							<Button size="xs" leftSection={<IconPlayerPlay size={14} />} onClick={() => void lab.playTts()} loading={lab.ttsBusy} disabled={!lab.text.trim()}>
								播放
							</Button>
						</Group>

						<Text size="sm" fw={600}>ASR 识别</Text>
						<Group gap="xs">
							{lab.voiceArmed ? (
								<Button size="xs" color="red" variant="light" onClick={lab.stopMonitor}>停止识别</Button>
							) : (
								<Button size="xs" onClick={lab.startMonitor}>开始识别</Button>
							)}
						</Group>
						{lab.transcript && <Text size="sm" c="dimmed">实时：{lab.transcript}</Text>}
						{lab.recognized && <Text size="sm">最终：{lab.recognized}</Text>}
						{(lab.error || lab.voiceNotice) && <Text size="sm" c="red">{lab.error ?? lab.voiceNotice}</Text>}
					</Stack>

					<Stack gap="sm" className="acoustic-waveforms">
						<Group justify="space-between" gap="sm">
							<Group gap="xs">
								<Text size="sm" fw={600}>实时波形</Text>
								<Badge size="xs" variant="light" color={lab.voiceArmed ? "teal" : "gray"}>
									{lab.voiceArmed ? "收音持续中" : "未收音"}
								</Badge>
								<Button size="compact-xs" variant="subtle" onClick={lab.voiceArmed ? lab.stopMonitor : lab.startMonitor}>
									{lab.voiceArmed ? "停止监测" : "开始监测"}
								</Button>
							</Group>
							<Select
								size="xs"
								value={lab.spanSeconds}
								onChange={(value) => value && lab.setSpanSeconds(value)}
								data={[
									{ value: "5", label: "5 秒" },
									{ value: "10", label: "10 秒" },
									{ value: "20", label: "20 秒" },
								]}
								aria-label="波形时间窗"
								w={92}
							/>
						</Group>
						<AcousticWaveform title="TTS 延迟参考" data={lab.waves.tts} color="var(--mantine-color-indigo-6)" seconds={Number(lab.spanSeconds)} version={lab.waveVersion} />
						<AcousticWaveform title="麦克风收音" data={lab.waves.mic} color="var(--mantine-color-orange-7)" seconds={Number(lab.spanSeconds)} version={lab.waveVersion} />
						<AcousticWaveform title="反相补偿后" data={lab.waves.clean} color="var(--mantine-color-teal-7)" seconds={Number(lab.spanSeconds)} version={lab.waveVersion} />
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
			return "滴声起音匹配，但回授增益不可用";
		default:
			return "声学特征匹配失败";
	}
}
