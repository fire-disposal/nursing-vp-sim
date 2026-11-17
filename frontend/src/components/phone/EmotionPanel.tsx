import { Box, Group, Progress, Stack, Text } from "@mantine/core";
import { EMOTION_DIM_LABELS, EMOTION_DIMS } from "@/engine/phone/emotion";
import type { EmotionVector, PhoneEmotionLabel } from "@/engine/phone/types";
import { PHONE_EMOTION_LABELS } from "@/engine/phone/types";

/**
 * EmotionPanel —— 四维数值 + 主导标签（**真实状态机**的可视化）。
 *
 * 数值直接来自 `usePhoneCall` 的向量，不经任何平滑或缓存：学生改一句话就能看见
 * 信任/烦躁的条子动，这就是这个演示页唯一想证明的事。
 *
 * 颜色口径：焦虑与烦躁用暖色（"越高越糟"），信任与配合用冷/绿色（"越高越好"）——
 * 四条同色会让人误以为都能"刷高"。
 */
const DIM_COLOR: Record<(typeof EMOTION_DIMS)[number], string> = {
	trust: "teal",
	anxiety: "orange",
	irritation: "red",
	cooperation: "blue",
};

const LABEL_COLOR: Record<PhoneEmotionLabel, string> = {
	irritated: "red",
	defensive: "orange",
	withdrawn: "gray",
	anxious_guarded: "orange",
	anxious_cooperative: "yellow",
	trusting_anxious: "lime",
	open_trusting: "teal",
	relaxed: "teal",
	neutral: "gray",
};

export interface EmotionPanelProps {
	emotion: EmotionVector;
	label: PhoneEmotionLabel;
	/** TTS 实际使用的情绪（服务端回显头）；与本地标签不同时说明 TTS 降级。 */
	ttsEmotion?: string | null;
	compact?: boolean;
}

export default function EmotionPanel({ emotion, label, ttsEmotion, compact = false }: EmotionPanelProps) {
	return (
		<Stack gap={compact ? 4 : 6} data-testid="emotion-panel">
			<Group justify="space-between" gap="xs" wrap="nowrap">
				<Text size="xs" c="dimmed">
					情绪
				</Text>
				<Text size="sm" fw={600} c={LABEL_COLOR[label]} data-testid="emotion-label">
					{PHONE_EMOTION_LABELS[label]}
				</Text>
			</Group>
			{EMOTION_DIMS.map((dim) => (
				<Box key={dim}>
					<Group justify="space-between" gap="xs" wrap="nowrap">
						<Text size="xs" c="dimmed">
							{EMOTION_DIM_LABELS[dim]}
						</Text>
						<Text size="xs" ff="monospace" c="dimmed">
							{emotion[dim].toFixed(2)}
						</Text>
					</Group>
					<Progress
						value={Math.round(emotion[dim] * 100)}
						color={DIM_COLOR[dim]}
						size={compact ? 4 : 6}
						radius="xl"
						aria-label={`${EMOTION_DIM_LABELS[dim]} ${Math.round(emotion[dim] * 100)}%`}
					/>
				</Box>
			))}
			{ttsEmotion && ttsEmotion !== label && (
				<Text size="xs" c="dimmed">
					TTS 情绪口径：{ttsEmotion}
				</Text>
			)}
		</Stack>
	);
}
