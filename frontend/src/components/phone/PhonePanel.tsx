import { Alert, Badge, Box, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
	IconArrowLeft,
	IconChartDots,
	IconMessage,
	IconMicrophone,
	IconPhoneCall,
	IconPhoneOff,
	IconPlayerStop,
	IconSend,
	IconTestPipe,
} from "@tabler/icons-react";
import { useState } from "react";
import type { PhoneCharacter } from "@/engine/phone/characters";
import { usePhoneCall } from "@/engine/phone/usePhoneCall";
import { PHONE_EMOTION_LABELS, PHONE_STAGE_LABELS } from "@/engine/phone/types";
import { BASIC_VOICE_NOTICE } from "@/hooks/useVoiceDialogue";
import CallStage from "./CallStage";
import CallStatusStrip from "./CallStatusStrip";
import EmotionPanel from "./EmotionPanel";
import QuickTestBar from "./QuickTestBar";
import TranscriptLog from "./TranscriptLog";
import "./PhonePanel.css";

/** 上方只读：动态角色 + 对话/运行数据。下方控制坞：语音为主，文字与测试为辅助。 */
export interface PhonePanelProps {
	character: PhoneCharacter;
	onBack: () => void;
	reducedMotion?: boolean;
}

export default function PhonePanel({ character, onBack, reducedMotion = false }: PhonePanelProps) {
	const call = usePhoneCall({ characterId: character.id });
	const [panelMode, setPanelMode] = useState<"conversation" | "diagnostics">("conversation");
	const [textOpen, setTextOpen] = useState(false);
	const [testsOpen, setTestsOpen] = useState(false);
	const narrow = useMediaQuery("(max-width: 48em)") === true;
	const textVisible = textOpen || call.continuousFailed || !call.voiceSupported || Boolean(call.voiceNotice);
	const voiceStatus = !call.continuousArmed
		? "语音尚未开启"
		: call.speaking
			? "对方在说"
			: call.speechActive
				? "正在听"
				: "聆听中";

	const submitDraft = () => {
		const text = call.draft.trim();
		if (!text || !call.dialed) return;
		call.setDraft("");
		call.handleUserText(text);
	};

	return (
		<Stack className="phone-panel" gap="md" data-testid="phone-panel">
			<Group justify="space-between" align="flex-start" className="phone-heading">
				<Text fw={650} size="lg">{character.name}</Text>
				<Badge variant="outline" color={call.dialed ? "teal" : "gray"}>
					{PHONE_STAGE_LABELS[call.stage]}
				</Badge>
			</Group>

			<Box className="phone-workspace">
				<Box className="phone-visual" aria-label="角色状态">
					<CallStage
						character={character}
						label={call.label}
						stage={call.stage}
						speaking={call.speaking}
						speechActive={call.speechActive}
						level={call.ttsLevel}
						reducedMotion={reducedMotion}
					/>
					<Box className="phone-emotion">
						<EmotionPanel emotion={call.emotion} label={call.label} ttsEmotion={call.metrics.ttsEmotion} compact />
					</Box>
				</Box>

				<Stack className="phone-data" gap="sm">
					<Group justify="space-between" gap="sm" wrap="wrap">
						<Text fw={600}>{panelMode === "conversation" ? "对话" : "数据"}</Text>
						<Text size="xs" c="dimmed">{PHONE_EMOTION_LABELS[call.label]}</Text>
					</Group>
					<CallStatusStrip
						stage={call.stage}
						voicePhase={call.voicePhase}
						continuousArmed={call.continuousArmed}
						basicVoiceMode={call.basicVoiceMode}
						continuousFailed={call.continuousFailed}
						ttsSpeaking={call.speaking}
						patientReplying={call.patientReplying}
						calibration={call.calibration}
					/>
					{(call.continuousFailed || call.basicVoiceMode) && (
						<Alert color="yellow" variant="light">
							{call.continuousFailed
								? "持续语音不可用，请展开底部文字输入。"
								: `${BASIC_VOICE_NOTICE}，语音仍可通过云转写提交。`}
						</Alert>
					)}
					{call.voiceNotice && !call.continuousFailed && !call.basicVoiceMode && (
						<Text size="sm" c="dimmed">{call.voiceNotice}</Text>
					)}
					<TranscriptLog
						lines={call.lines}
						log={call.log}
						metrics={call.metrics}
						liveTranscript={call.transcript}
						mode={panelMode}
						height={narrow ? 280 : 420}
					/>
				</Stack>
			</Box>

			<Box className="phone-control-dock" data-testid="phone-controls">
				<Group gap="xs" wrap="wrap" className="phone-primary-controls">
					<Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={16} />} onClick={onBack}>
						角色
					</Button>
					{call.dialed ? (
						<Button color="red" variant="light" leftSection={<IconPhoneOff size={16} />} onClick={call.stopCall}>
							结束通话
						</Button>
					) : (
						<Button leftSection={<IconPhoneCall size={16} />} onClick={call.startCall}>
							开始通话
						</Button>
					)}
					<Button
						variant="light"
						color="orange"
						leftSection={<IconPlayerStop size={16} />}
						onClick={() => call.handleBargeIn("manual")}
						disabled={!call.speaking}
					>
						停播
					</Button>
					<Group gap={6} className="phone-voice-status" aria-live="polite">
						<IconMicrophone size={16} />
						<Text size="sm">{voiceStatus}</Text>
					</Group>
					<Group gap={4} wrap="nowrap">
						<Button
							variant={textVisible ? "light" : "subtle"}
							leftSection={<IconMessage size={16} />}
							onClick={() => setTextOpen((open) => !open)}
							aria-expanded={textVisible}
						>
							文字
						</Button>
						<Button
							variant={testsOpen ? "light" : "subtle"}
							leftSection={<IconTestPipe size={16} />}
							onClick={() => setTestsOpen((open) => !open)}
							aria-expanded={testsOpen}
						>
							测试
						</Button>
						<Button
							variant={panelMode === "diagnostics" ? "light" : "subtle"}
							leftSection={<IconChartDots size={16} />}
							onClick={() => setPanelMode((mode) => (mode === "conversation" ? "diagnostics" : "conversation"))}
							aria-pressed={panelMode === "diagnostics"}
						>
							诊断
						</Button>
					</Group>
				</Group>

				{textVisible && (
					<form
						className="phone-text-controls"
						onSubmit={(event) => {
							event.preventDefault();
							submitDraft();
						}}
					>
						<TextInput
							style={{ flex: 1 }}
							placeholder={call.dialed ? "文字输入" : "先开始通话"}
							value={call.draft}
							onChange={(event) => call.setDraft(event.currentTarget.value)}
							disabled={!call.dialed}
							aria-label="文字输入"
						/>
						<Button type="submit" disabled={!call.dialed || !call.draft.trim()} leftSection={<IconSend size={15} />}>
							发送
						</Button>
					</form>
				)}
				{testsOpen && <QuickTestBar onRun={call.runQuickTest} disabled={!call.dialed} compact={narrow} />}
			</Box>
		</Stack>
	);
}
