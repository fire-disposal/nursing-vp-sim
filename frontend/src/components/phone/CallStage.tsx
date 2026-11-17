import { Badge, Box, Stack, Text } from "@mantine/core";
import { IconMicrophone, IconVolume } from "@tabler/icons-react";
import type { PhoneCharacter } from "@/engine/phone/characters";
import { PHONE_STAGE_LABELS, type PhoneEmotionLabel, type PhoneStage } from "@/engine/phone/types";
import PhoneMiiAvatar from "./PhoneMiiAvatar";

/** 角色舞台只展示可证实的状态：真实音频、有效语音与当前阶段。 */
export interface CallStageProps {
	character: PhoneCharacter;
	label: PhoneEmotionLabel;
	stage: PhoneStage;
	speaking: boolean;
	speechActive: boolean;
	level: number;
	reducedMotion: boolean;
}

export default function CallStage({
	character,
	label,
	stage,
	speaking,
	speechActive,
	level,
	reducedMotion,
}: CallStageProps) {
	const listening = speechActive || stage === "user_speaking";
	const hint = speaking
		? "直接说话，识别确认后停播"
		: stage === "waiting_reply"
			? "文本尚未返回，暂不显示对方气泡"
			: stage === "user_speaking"
				? "识别确认后发送"
				: stage === "greeting"
					? "接通音后播放开场白"
					: "直接说话或输入文字";

	return (
		<Stack gap="xs" align="center" data-testid="call-stage">
			<Box className="phone-stage-frame">
				<PhoneMiiAvatar
					character={character}
					label={label}
					speaking={speaking}
					listening={listening}
					level={level}
					reducedMotion={reducedMotion}
					fill
				/>
				<Box className="phone-stage-badge">
					<Badge
						variant="light"
						color={speaking ? "indigo" : listening ? "teal" : "gray"}
						leftSection={listening ? <IconMicrophone size={12} /> : <IconVolume size={12} />}
					>
						{speaking ? "对方正在播报" : listening ? "检测到你的声音" : PHONE_STAGE_LABELS[stage]}
					</Badge>
				</Box>
			</Box>
			<Text size="xs" c="dimmed" ta="center">
				{hint}
			</Text>
		</Stack>
	);
}
