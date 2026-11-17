import { Badge, Box, Stack, Text } from "@mantine/core";
import { IconMicrophone, IconVolume } from "@tabler/icons-react";
import type { PhoneCharacter } from "@/engine/phone/characters";
import type { PhoneEmotionLabel } from "@/engine/phone/types";
import PhoneMiiAvatar from "./PhoneMiiAvatar";
import type { VoicePhase } from "@/hooks/voiceTypes";

/**
 * CallStage —— 形象 + VAD 波形 + 打断提示。
 *
 * 三种视觉态互相排斥、都可从真实状态推出：
 *   speaking  → TTS 在出声：口型随 `level` 开合，标注"对方在说"；
 *   listening → 学生开口（VAD 已确认）：头像做聆听姿态 + 波形走声，
 *               此时学生可以打断她；
 *   idle      → 静音：口型闭合，波形压平。
 *
 * `reducedMotion` 下波形条退化为静态中间值（不跑 rAF 关键帧），口型固定微张。
 */
export interface CallStageProps {
	character: PhoneCharacter;
	label: PhoneEmotionLabel;
	voicePhase: VoicePhase;
	speaking: boolean;
	listening: boolean;
	speechActive: boolean;
	level: number;
	reducedMotion: boolean;
	/** 窄屏：缩小头像，减少纵向占用。 */
	compact?: boolean;
}

export default function CallStage({
	character,
	label,
	voicePhase,
	speaking,
	listening,
	speechActive,
	level,
	reducedMotion,
	compact = false,
}: CallStageProps) {
	const mine = speaking && !listening;
	return (
		<Stack gap="xs" align="center" data-testid="call-stage">
			<Box style={{ width: compact ? "min(100%, 200px)" : "min(100%, 320px)", position: "relative" }}>
				<PhoneMiiAvatar
					character={character}
					label={label}
					speaking={mine}
					listening={listening}
					level={level}
					reducedMotion={reducedMotion}
					fill
				/>
				{(mine || listening) && (
					<Box
						style={{
							position: "absolute",
							bottom: 10,
							insetInline: 0,
							display: "flex",
							justifyContent: "center",
						}}
					>
						<Badge
							variant="light"
							color={!listening ? "indigo" : speechActive ? "teal" : "gray"}
							leftSection={listening ? <IconMicrophone size={12} /> : <IconVolume size={12} />}
						>
							{!listening ? "对方正在说" : speechActive ? "正在聆听你说话" : "VAD 聆听中"}
						</Badge>
					</Box>
				)}
			</Box>
			{listening ? (
				<Text size="xs" c="dimmed">
					{speechActive ? `VAD 已确认你开口（${voicePhase}）` : "VAD 聆听中，等待你开口"}
				</Text>
			) : speaking ? (
				<Text size="xs" c="dimmed">
					开口说话，识别确认后打断
				</Text>
			) : null}
		</Stack>
	);
}
