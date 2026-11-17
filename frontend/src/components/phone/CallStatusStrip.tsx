import { Badge, Group, Tooltip } from "@mantine/core";
import { IconActivity, IconCheck, IconLoader2, IconMicrophone, IconMicrophoneOff, IconVolume, IconX } from "@tabler/icons-react";
import type { PhoneCalibration } from "@/engine/phone/usePhoneCall";
import type { PhoneStage } from "@/engine/phone/types";
import { PHONE_STAGE_LABELS } from "@/engine/phone/types";
import type { VoicePhase } from "@/hooks/voiceTypes";

/**
 * 通话状态条 —— VAD / ASR / TTS / 阶段四个真实状态并排。
 *
 * 四个都是**数据源原样**，不做美化：
 *   - VAD：`continuousArmed` 才真的在聆听；`basicVoiceMode` 说明 VAD 跟不上实时，
 *     只剩 PCM + 云转写（此时不能声称"VAD 检出了语音"）；
 *   - ASR：`VoicePhase` + 实时转写；
 *   - TTS：播放器事件（首块/合成中/静音）；
 *   - 阶段：本地通话阶段（greeting → listening → patient_speaking）。
 */
export interface CallStatusStripProps {
	stage: PhoneStage;
	voicePhase: VoicePhase;
	continuousArmed: boolean;
	basicVoiceMode: boolean;
	continuousFailed: boolean;
	ttsSpeaking: boolean;
	patientReplying: boolean;
	calibration: PhoneCalibration | null;
}

export default function CallStatusStrip({
	stage,
	voicePhase,
	continuousArmed,
	basicVoiceMode,
	continuousFailed,
	ttsSpeaking,
	patientReplying,
	calibration,
}: CallStatusStripProps) {
	const vadLabel = continuousFailed
		? "不可用"
		: basicVoiceMode
			? "基础语音模式"
			: continuousArmed
				? voicePhase === "listening"
					? "聆听中"
					: "待命"
				: "未开启";
	const vadColor = continuousFailed ? "red" : basicVoiceMode ? "yellow" : continuousArmed ? "green" : "gray";

	const asrLabel =
		voicePhase === "listening"
			? "正在识别"
			: voicePhase === "sending"
				? "已判句"
				: voicePhase === "awaiting"
					? "等待中"
					: "空闲";

	const ttsLabel = ttsSpeaking ? (patientReplying ? "正在说" : "播报尾音") : "静音";

	return (
		<Group gap="xs" wrap="wrap" data-testid="call-status">
			<Tooltip
				label={
					calibration?.status === "success"
						? `延迟 ${calibration.delayMs}ms，增益 ${calibration.gain?.toFixed(3)}，特征匹配度 ${calibration.score?.toFixed(2) ?? "稳定电平"}`
						: calibration?.status === "failed"
							? "未通过声学匹配，双工未开放"
							: "等待三次滴声时间差匹配"
				}
				withArrow
			>
				<Badge
					variant="light"
					color={calibration?.status === "success" ? "green" : calibration?.status === "failed" ? "red" : "yellow"}
					leftSection={
						calibration?.status === "success" ? <IconCheck size={12} /> : calibration?.status === "failed" ? <IconX size={12} /> : <IconLoader2 size={12} />
					}
					data-testid="calibration-badge"
				>
					{calibration?.status === "success"
						? `匹配成功 ${calibration.delayMs}ms`
						: calibration?.status === "failed"
							? "匹配失败"
							: calibration?.status === "pending"
								? "校准中"
								: "未校准"}
				</Badge>
			</Tooltip>
			<Tooltip label="语音活动检测：识别是否有人开口、何时算一句话说完" withArrow>
				<Badge
					variant="light"
					color={vadColor}
					leftSection={continuousArmed ? <IconActivity size={12} /> : <IconMicrophoneOff size={12} />}
				>
					VAD {vadLabel}
				</Badge>
			</Tooltip>
			<Tooltip label="语音转写：partial 为实时字幕，definite 才算一句落定" withArrow>
				<Badge variant="light" color={voicePhase === "listening" ? "teal" : "gray"} leftSection={<IconMicrophone size={12} />}>
					ASR {asrLabel}
				</Badge>
			</Tooltip>
			<Badge variant="light" color={ttsSpeaking ? "indigo" : "gray"} leftSection={<IconVolume size={12} />}>
				TTS {ttsLabel}
			</Badge>
			<Badge variant="outline" color="grape">
				阶段 {PHONE_STAGE_LABELS[stage]}
			</Badge>
		</Group>
	);
}
