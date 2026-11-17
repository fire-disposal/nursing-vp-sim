import { Badge, Box, Group, Stack, Text } from "@mantine/core";
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
	level: number;
	reducedMotion: boolean;
	/** 波形条数（桌面多一些）。 */
	bars?: number;
	/** 窄屏：缩小头像与波形，减少纵向占用。 */
	compact?: boolean;
}

export function waveformHeights(level: number, bars: number, reducedMotion: boolean): number[] {
	if (reducedMotion) return Array.from({ length: bars }, () => 20);
	return Array.from({ length: bars }, (_, i) => {
		const phase = (i / bars) * Math.PI * 2;
		const wobble = 0.5 + 0.5 * Math.sin(phase * 2.2 + level * 9);
		return Math.round(8 + wobble * 26 * (0.35 + level));
	});
}

export default function CallStage({
	character,
	label,
	voicePhase,
	speaking,
	listening,
	level,
	reducedMotion,
	bars = 28,
	compact = false,
}: CallStageProps) {
	const heights = waveformHeights(level, bars, reducedMotion);
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
							color={listening ? "teal" : "indigo"}
							leftSection={listening ? <IconMicrophone size={12} /> : <IconVolume size={12} />}
						>
							{listening ? "正在聆听你说话" : "对方正在说"}
						</Badge>
					</Box>
				)}
			</Box>
			<Group
				gap={3}
				justify="center"
				align="flex-end"
				h={40}
				wrap="nowrap"
				aria-hidden
				data-testid="waveform"
				style={{ opacity: listening || speaking ? 1 : 0.35 }}
			>
				{heights.map((h, i) => (
					<Box
						key={i}
						style={{
							width: 4,
							height: h,
							borderRadius: 2,
							background: listening ? character.palette.accent : character.palette.primary,
							transition: reducedMotion ? undefined : "height 120ms linear",
						}}
					/>
				))}
			</Group>
			{listening ? (
				<Text size="xs" c="dimmed">
					VAD 已确认你开口（{voicePhase}）
				</Text>
			) : speaking ? (
				<Text size="xs" c="dimmed">
					开口即可打断
				</Text>
			) : null}
		</Stack>
	);
}
