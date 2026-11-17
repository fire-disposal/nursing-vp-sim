import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Button,
	Card,
	Flex,
	Group,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
	IconArrowLeft,
	IconPhoneCall,
	IconPhoneOff,
	IconPlayerStop,
	IconSend,
} from "@tabler/icons-react";
import type { PhoneCharacter } from "@/engine/phone/characters";
import { usePhoneCall } from "@/engine/phone/usePhoneCall";
import { BASIC_VOICE_NOTICE } from "@/hooks/useVoiceDialogue";
import CallStage from "./CallStage";
import CallStatusStrip from "./CallStatusStrip";
import EmotionPanel from "./EmotionPanel";
import QuickTestBar from "./QuickTestBar";
import TranscriptLog from "./TranscriptLog";

/**
 * PhonePanel —— 一通演示电话的完整界面。
 *
 * 布局（桌面 → 移动端同构，只是从三栏塌成一栏）：
 *   ┌ 头部：返回角色卡 · 名字/脾气 · 停止通话 ┐
 *   ├ 左：程序化角色形象（口型由真实 TTS 输出驱动）
 *   ├ 中：状态条 + 四维情绪 + 转写 + 事件日志 │
 *   └ 底：快捷用例 + 实时转写 + 文本输入      ┘
 *
 * 数据全部来自 `usePhoneCall`：它内部用 `recordId: 0` 走 demo ASR，回复来自
 * `POST /api/voice-demo/chat/stream`（后端权威角色 Prompt），播报走 `DemoTTSPlayer`。
 * 这里不 import 任何训练 store / 评分。
 */
export interface PhonePanelProps {
	character: PhoneCharacter;
	onBack: () => void;
	reducedMotion?: boolean;
}

export default function PhonePanel({ character, onBack, reducedMotion = false }: PhonePanelProps) {
	const call = usePhoneCall({ characterId: character.id });
	const started = call.dialed;
	const listening = call.voicePhase === "listening" && !call.speaking;
	const narrow = useMediaQuery("(max-width: 48em)") === true;

	const stop = () => call.stopCall();

	const submitDraft = () => {
		const text = call.draft.trim();
		if (!text) return;
		call.setDraft("");
		call.handleUserText(text);
	};

	return (
		<Stack gap="sm" data-testid="phone-panel">
			<Card withBorder radius="lg" padding="sm">
				<Group justify="space-between" wrap="wrap" gap="sm">
					<Group gap="sm" wrap="nowrap" style={{ flex: "1 1 140px", minWidth: 0 }}>
						<Tooltip label="返回角色卡" withArrow>
							<ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label="返回角色卡">
								<IconArrowLeft size={18} />
							</ActionIcon>
						</Tooltip>
						<Stack gap={0} style={{ minWidth: 0 }}>
							<Text fw={600}>{character.name}</Text>
							<Text size="xs" c="dimmed" lineClamp={1}>
								{character.temperament} · {character.voice}
							</Text>
						</Stack>
					</Group>
					<Group gap="xs" wrap="nowrap" style={{ marginLeft: "auto" }}>
						{started && (
							<Button
								color="red"
								variant="light"
								leftSection={<IconPhoneOff size={16} />}
								onClick={stop}
							>
								停止通话
							</Button>
						)}
					</Group>
				</Group>
			</Card>

			{!started ? (
				<Card withBorder radius="lg" padding="md">
					<Group align="center" wrap="wrap" gap="lg">
						<Box style={{ width: narrow ? "100%" : 220, flexShrink: 0 }}>
							<CallStage
								character={character}
								label={call.label}
								voicePhase="idle"
								speaking={false}
								listening={false}
								speechActive={false}
								level={0}
								reducedMotion={reducedMotion}
								compact={narrow}
							/>
						</Box>
						<Stack gap="sm" style={{ flex: "1 1 260px", minWidth: 0 }}>
							<Title order={4} size="h5">
								准备与{character.name}通话
							</Title>
							<Text size="sm" c="dimmed">
								{character.temperament}
							</Text>
							<Text size="sm">{character.callAbout}</Text>
							<Text size="xs" c="dimmed">
								音色：{character.voice}
							</Text>
							<Button
								leftSection={<IconPhoneCall size={16} />}
								onClick={call.startCall}
								w={narrow ? "100%" : undefined}
								mt={4}
								style={{ alignSelf: "flex-start" }}
							>
								开始通话
							</Button>
						</Stack>
					</Group>
				</Card>
			) : (
				<>
					<CallStatusStrip
				stage={call.stage}
				voicePhase={call.voicePhase}
				continuousArmed={call.continuousArmed}
				basicVoiceMode={call.basicVoiceMode}
				continuousFailed={call.continuousFailed}
				ttsSpeaking={call.speaking}
				patientReplying={call.stage === "patient_speaking"}
			/>

			{(call.continuousFailed || call.basicVoiceMode) && (
				<Alert color="yellow" variant="light" title="语音模式提示">
					{call.continuousFailed
						? "持续对谈启动失败（麦克风权限或浏览器限制）。可用下方文本输入继续演示。"
						: `${BASIC_VOICE_NOTICE}：VAD 跟不上实时，仅用云转写判句。`}
				</Alert>
			)}
			{call.voiceNotice && !call.continuousFailed && !call.basicVoiceMode && (
				<Text size="xs" c="dimmed">
					{call.voiceNotice}
				</Text>
			)}

			<Box
				style={{
					display: "grid",
					gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 320px), 1fr))`,
					gap: "var(--mantine-spacing-md)",
					alignItems: "start",
				}}
			>
				<Card withBorder radius="lg" padding="sm">
					<CallStage
						character={character}
						label={call.label}
						voicePhase={call.voicePhase}
						speaking={call.speaking}
						listening={listening}
						speechActive={call.speechActive}
						level={call.ttsLevel}
						reducedMotion={reducedMotion}
						compact={narrow}
					/>
				</Card>
				<Card withBorder radius="lg" padding="sm">
					<Stack gap="sm">
						<EmotionPanel
							emotion={call.emotion}
							label={call.label}
							ttsEmotion={call.metrics.ttsEmotion}
						/>
						<Group gap="xs" wrap="wrap">
							<Badge variant="light" color={call.voiceSupported ? "teal" : "red"}>
								{call.voiceSupported ? "语音输入可用" : "语音输入不可用"}
							</Badge>
							<Badge variant="light" color={call.turnDetection ? "green" : "yellow"}>
								{call.turnDetection ? "VAD 轮次检测" : "无 VAD（云转写判句）"}
							</Badge>
							<Badge variant="light" color={started ? "blue" : "gray"}>
								{started ? "通话中" : "未开始"}
							</Badge>
						</Group>
						<TranscriptLog
							lines={call.lines}
							log={call.log}
							metrics={call.metrics}
							liveTranscript={call.transcript}
							stacked={narrow}
							height={narrow ? 72 : 240}
						/>
					</Stack>
				</Card>
			</Box>

			<Card withBorder radius="lg" padding="sm">
				<Stack gap="sm">
					<QuickTestBar onRun={call.runQuickTest} disabled={!started} compact={narrow} />
					<Flex direction={narrow ? "column" : "row"} gap="xs" align={narrow ? "stretch" : "flex-end"}>
						<TextInput
							style={{ flex: 1 }}
							placeholder="输入文字，或直接说话"
							value={call.draft}
							onChange={(e) => call.setDraft(e.currentTarget.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) submitDraft();
							}}
							aria-label="文本输入"
						/>
						<Group gap="xs" wrap="nowrap" justify={narrow ? "flex-end" : "flex-start"}>
							<Button
								variant="filled"
								onClick={submitDraft}
								disabled={!call.draft.trim()}
								leftSection={<IconSend size={16} />}
							>
								发送
							</Button>
							<Tooltip label="立即停播（打断）" withArrow>
								<ActionIcon
									variant="light"
									color="red"
									size="lg"
									onClick={call.handleBargeIn}
									disabled={!call.speaking}
									aria-label="停播"
								>
									<IconPlayerStop size={18} />
								</ActionIcon>
							</Tooltip>
						</Group>
					</Flex>
				</Stack>
				</Card>
				</>
			)}
		</Stack>
	);
}
