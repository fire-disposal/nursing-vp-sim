import { Badge, Button, Card, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconPlayerPlay, IconPlayerStop, IconRefresh } from "@tabler/icons-react";
import { PHONE_CHARACTERS } from "@/engine/phone/characters";
import { useAcousticWorkbench } from "@/engine/audio/useAcousticWorkbench";
import AcousticWaveform from "./AcousticWaveform";
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
						<Text size="sm" c="dimmed">AEC3 · TTS · ASR</Text>
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
						{lab.aec3Stats && (
							<Text size="xs" c="dimmed">
								AEC3 延迟 {lab.aec3Stats.delayMs ?? "—"}ms · ERLE {lab.aec3Stats.erleDb?.toFixed(1) ?? "—"}dB · 参考缺失 {lab.aec3Stats.referenceShort} · 参考丢弃 {lab.aec3Stats.referenceDropped}
							</Text>
						)}
						<Text size="sm" fw={600}>TTS</Text>
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

						<Text size="sm" fw={600}>ASR</Text>
						<Group gap="xs">
							{lab.voiceArmed ? (
								<Button size="xs" color="red" variant="light" onClick={lab.stopMonitor}>停止</Button>
							) : (
								<Button size="xs" onClick={lab.startMonitor}>开始</Button>
							)}
						</Group>
						{lab.transcript && <Text size="sm" c="dimmed">实时：{lab.transcript}</Text>}
						{lab.recognized && <Text size="sm">最终：{lab.recognized}</Text>}
						{(lab.error || lab.voiceNotice) && <Text size="sm" c="red">{lab.error ?? lab.voiceNotice}</Text>}
					</Stack>

					<Stack gap="sm" className="acoustic-waveforms">
						<Group justify="space-between" gap="sm">
							<Group gap="xs">
								<Text size="sm" fw={600}>波形</Text>
								<Badge size="xs" variant="light" color={lab.voiceArmed ? "teal" : "gray"}>
									{lab.voiceArmed ? "收音持续中" : "未收音"}
								</Badge>
								<Button size="compact-xs" variant="subtle" onClick={lab.voiceArmed ? lab.stopMonitor : lab.startMonitor}>
									{lab.voiceArmed ? "停止" : "开始"}
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
						<AcousticWaveform title="TTS 参考" data={lab.waves.tts} color="var(--mantine-color-indigo-6)" seconds={Number(lab.spanSeconds)} />
						<AcousticWaveform title="麦克风" data={lab.waves.mic} color="var(--mantine-color-orange-7)" seconds={Number(lab.spanSeconds)} />
						<AcousticWaveform title="AEC3 输出" data={lab.waves.clean} color="var(--mantine-color-teal-7)" seconds={Number(lab.spanSeconds)} />
					</Stack>
				</div>
			</Stack>
		</Card>
	);
}


