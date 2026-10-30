import {
	Badge,
	Box,
	Button,
	Container,
	Group,
	Paper,
	Progress,
	SimpleGrid,
	Stack,
	Switch,
	Text,
} from "@mantine/core";
import { IconMovie } from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import PatientPresenter from "@/components/training/presentation/PatientPresenter";
import { buildMiiAvatarPayload } from "@/components/training/presentation/presenters/miiAvatar";
import type { PatientIdentity } from "@/components/training/presentation/types";
import PageHeader from "@/components/ui/page-header";
import { useAudioEnvelope } from "@/hooks/useAudioEnvelope";
import {
	EMOTION_4D_LABELS,
	EMOTION_LABELS,
	type Emotion4DLabel,
	type EmotionState,
} from "@/stores/trainingStore";

/**
 * 表现层试验台（M3）— 全程序化绘制的患者形象：不加载任何图片，脸是代码画出来的。
 *
 * 这里**不接训练会话、不写业务数据、不调 LLM**：只有身份、情绪枚举与现成的测试音频。
 * 绘制实现见 `components/training/presentation/engine/mii.ts`；生产策略链仍为
 * realistic → static，本页要等接线后才对外。
 */

interface LabPreset {
	key: string;
	label: string;
	patient: PatientIdentity;
}

const PRESETS: LabPreset[] = [
	{ key: "wang", label: "王建国 · 68 男", patient: { name: "王建国", age: 68, gender: "male" } },
	{ key: "zhang", label: "张美华 · 55 女", patient: { name: "张美华", age: 55, gender: "female" } },
	{ key: "child-m", label: "儿童 · 8 男", patient: { name: null, age: 8, gender: "male" } },
	{ key: "child-f", label: "儿童 · 8 女", patient: { name: null, age: 8, gender: "female" } },
	{ key: "youth-m", label: "青年 · 20 男", patient: { name: null, age: 20, gender: "male" } },
	{ key: "youth-f", label: "青年 · 20 女", patient: { name: null, age: 20, gender: "female" } },
	{ key: "middle-m", label: "中年 · 45 男", patient: { name: null, age: 45, gender: "male" } },
	{ key: "middle-f", label: "中年 · 45 女", patient: { name: null, age: 45, gender: "female" } },
	{ key: "elder-m", label: "老年 · 78 男", patient: { name: null, age: 78, gender: "male" } },
	{ key: "elder-f", label: "老年 · 78 女", patient: { name: null, age: 78, gender: "female" } },
];

const EMOTIONS: EmotionState[] = ["withdrawn", "defensive", "anxious", "neutral", "relaxed", "open"];

/** 6 态 → 4D 标签：本页只驱动表情参数，四维数值不参与绘制。 */
const EMOTION_4D_BY_EMOTION: Record<EmotionState, Emotion4DLabel> = {
	withdrawn: "withdrawn",
	defensive: "defensive",
	anxious: "anxious_guarded",
	neutral: "neutral",
	relaxed: "relaxed",
	open: "open_trusting",
};

const LAB_VALUES = { trust: 50, anxiety: 45, irritation: 30, cooperation: 60 };

const TRACKS = [
	{ key: "neutral", label: "正常", src: "/audio/tts-patient-neutral.wav" },
	{ key: "anxious", label: "焦虑", src: "/audio/tts-patient-anxious.wav" },
	{ key: "defensive", label: "防御", src: "/audio/tts-patient-defensive.wav" },
	{ key: "trusting", label: "信任", src: "/audio/tts-patient-trusting.wav" },
] as const;

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<Paper withBorder radius="lg" p="md">
			<Stack gap="sm">
				<Group justify="space-between" align="center">
					<Text fw={600}>{title}</Text>
					{hint && (
						<Text size="xs" c="dimmed">
							{hint}
						</Text>
					)}
				</Group>
				<Box style={{ width: "100%", maxWidth: 340 }}>{children}</Box>
			</Stack>
		</Paper>
	);
}

export default function PresentationLab() {
	const [presetKey, setPresetKey] = useState(PRESETS[0].key);
	const [emotion, setEmotion] = useState<EmotionState>("neutral");
	const [reducedMotion, setReducedMotion] = useState(false);
	const [manualSpeaking, setManualSpeaking] = useState(false);
	const [track, setTrack] = useState<string | null>(null);
	const [audioPlaying, setAudioPlaying] = useState(false);
	const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
	const envelope = useAudioEnvelope(audioEl);

	const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
	const speaking = manualSpeaking || audioPlaying;

	const snapshot = useMemo(
		() => ({
			emotion,
			emotion4D: EMOTION_4D_BY_EMOTION[emotion],
			values: LAB_VALUES,
		}),
		[emotion],
	);

	const payload = useMemo(() => buildMiiAvatarPayload(preset.patient, snapshot), [preset, snapshot]);

	useEffect(() => () => audioEl?.pause(), [audioEl]);

	const playTrack = (key: string, src: string) => {
		const el = audioEl;
		if (!el) return;
		el.src = src;
		el.currentTime = 0;
		setTrack(key);
		void el.play().catch((err) => console.warn("[lab] 播放失败", err));
	};

	const stopTrack = () => {
		if (!audioEl) return;
		audioEl.pause();
		audioEl.currentTime = 0;
		setTrack(null);
	};

	return (
		<Container size="lg" py="xl">
			<PageHeader
				title="患者表现试验台"
				subtitle="全程序化绘制：不加载任何立绘，脸与口型都是代码画出来的。不参与评分与训练，不写业务数据。"
				icon={IconMovie}
			/>

			<Stack gap="lg">
				<Paper withBorder radius="lg" p="md">
					<Stack gap="md">
						<Box>
							<Text size="sm" fw={600} mb={6}>
								身份（10 种：年龄 × 性别，含两位论文病例）
							</Text>
							<Group gap={6}>
								{PRESETS.map((p) => (
									<Button
										key={p.key}
										size="compact-sm"
										variant={p.key === presetKey ? "filled" : "light"}
										onClick={() => setPresetKey(p.key)}
									>
										{p.label}
									</Button>
								))}
							</Group>
						</Box>

						<Box>
							<Text size="sm" fw={600} mb={6}>
								情绪（6 态，只改表情）
							</Text>
							<Group gap={6}>
								{EMOTIONS.map((e) => (
									<Button
										key={e}
										size="compact-sm"
										variant={e === emotion ? "filled" : "light"}
										onClick={() => setEmotion(e)}
									>
										{EMOTION_LABELS[e]}
										<Text component="span" size="xs" opacity={0.6} ml={6}>
											{EMOTION_4D_LABELS[EMOTION_4D_BY_EMOTION[e]]}
										</Text>
									</Button>
								))}
							</Group>
						</Box>

						<Box>
							<Text size="sm" fw={600} mb={6}>
								测试音频（本页播放，口型跟着它的包络走，不经训练链路）
							</Text>
							<Group gap={6} align="center">
								{TRACKS.map((t) => (
									<Button
										key={t.key}
										size="compact-sm"
										variant={track === t.key ? "filled" : "light"}
										onClick={() => playTrack(t.key, t.src)}
									>
										播放{t.label}
									</Button>
								))}
								<Button size="compact-sm" variant="subtle" color="gray" onClick={stopTrack}>
									停止
								</Button>
							</Group>
							<Group gap="md" mt="sm" align="center" wrap="nowrap">
								<Badge variant="light" color={speaking ? "green" : "gray"}>
									{speaking ? "说话中" : "静止"}
								</Badge>
								<Progress value={envelope * 100} w={180} aria-label="音频包络" />
								<Text size="sm" ff="monospace" w={72}>
									{envelope.toFixed(3)}
								</Text>
								<Text size="xs" c="dimmed">
									包络（0..1，约 30Hz）
								</Text>
							</Group>
							<audio
								ref={setAudioEl}
								hidden
								onPlay={() => setAudioPlaying(true)}
								onPause={() => setAudioPlaying(false)}
								onEnded={() => setAudioPlaying(false)}
							/>
						</Box>

						<Group gap="lg">
							<Switch
								label="减少动效（系统偏好等效，强制静止帧）"
								checked={reducedMotion}
								onChange={(e) => setReducedMotion(e.currentTarget.checked)}
							/>
							<Switch
								label="手动模拟说话（不播音频也能看口型）"
								checked={manualSpeaking}
								onChange={(e) => setManualSpeaking(e.currentTarget.checked)}
							/>
						</Group>
					</Stack>
				</Paper>

				<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
					<Panel title="静止帧" hint="同一份绘制，时间固定">
						<PatientPresenter presentation={payload} fill reducedMotion />
					</Panel>
					<Panel
						title="动效"
						hint={
							reducedMotion
								? "减少动效已开 → 静止帧"
								: speaking
									? "眨眼 + 呼吸 + 包络口型"
									: "眨眼 + 呼吸"
						}
					>
						<PatientPresenter
							presentation={payload}
							fill
							speaking={speaking}
							envelope={envelope}
							reducedMotion={reducedMotion}
						/>
					</Panel>
				</SimpleGrid>
			</Stack>
		</Container>
	);
}
