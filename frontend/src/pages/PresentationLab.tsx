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
import { buildLiveAvatarPayload } from "@/components/training/presentation/presenters/liveAvatar";
import { buildRigAvatarPayload } from "@/components/training/presentation/presenters/rigAvatar";
import type { PatientIdentity } from "@/components/training/presentation/types";
import PageHeader from "@/components/ui/page-header";
import { useAudioEnvelope } from "@/hooks/useAudioEnvelope";
import {
	EMOTION_4D_LABELS,
	EMOTION_LABELS,
	type Emotion4DLabel,
	type EmotionState,
} from "@/stores/trainingStore";
import { getNurseAvatar } from "@/utils/avatar";

/**
 * 表现层试验台（M1）— 给教研侧看「单张立绘 + 2D 动效」够不够支撑在场感。
 *
 * 这里**不接训练会话、不写业务数据、不调 LLM**：只有素材、情绪枚举与现成的测试音频。
 * 动效策略实现见 `components/training/presentation/presenters/liveAvatar.tsx`；
 * 生产策略链仍为 realistic → static，本页要等 M3 才接线。
 */

interface LabPreset {
	key: string;
	label: string;
	patient: PatientIdentity;
	/** 素材库里不参与患者路由的立绘（护士），直接指定图与替代文本。 */
	directSrc?: string;
	directAlt?: string;
}

const PATIENT = (age: number, gender: "male" | "female"): PatientIdentity => ({
	name: null,
	age,
	gender,
});

const PRESETS: LabPreset[] = [
	{ key: "wang", label: "王建国 · 68 男（写实病例）", patient: { name: "王建国", age: 68, gender: "male" } },
	{ key: "zhang", label: "张美华 · 55 女（写实病例）", patient: { name: "张美华", age: 55, gender: "female" } },
	{ key: "child-m", label: "儿童 · 8 男", patient: PATIENT(8, "male") },
	{ key: "child-f", label: "儿童 · 8 女", patient: PATIENT(8, "female") },
	{ key: "youth-m", label: "青年 · 20 男", patient: PATIENT(20, "male") },
	{ key: "youth-f", label: "青年 · 20 女", patient: PATIENT(20, "female") },
	{ key: "middle-m", label: "中年 · 40 男", patient: PATIENT(40, "male") },
	{ key: "middle-f", label: "中年 · 40 女", patient: PATIENT(40, "female") },
	{ key: "elder-m", label: "老年 · 70 男", patient: PATIENT(70, "male") },
	{ key: "elder-f", label: "老年 · 70 女", patient: PATIENT(70, "female") },
	{ key: "nurse-f", label: "护士 · 女（素材库）", patient: PATIENT(30, "female"), directSrc: getNurseAvatar("female"), directAlt: "护士" },
	{ key: "nurse-m", label: "护士 · 男（素材库）", patient: PATIENT(30, "male"), directSrc: getNurseAvatar("male"), directAlt: "护士" },
];

const EMOTIONS: EmotionState[] = ["withdrawn", "defensive", "anxious", "neutral", "relaxed", "open"];

/** 6 态 → 4D 标签：本页只驱动情绪配色与节奏，四维数值不参与 live 的 build。 */
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

	/** 12 张立绘同一份负载：静态面板与动效面板渲染的是同一条数据，差异只来自运行时的 ctx。 */
	const payload = useMemo(() => {
		const built = buildLiveAvatarPayload(preset.patient, snapshot);
		if (!preset.directSrc) return built;
		return { ...built, src: preset.directSrc, alt: preset.directAlt ?? built.alt };
	}, [preset, snapshot]);

	/** 自绘引擎的负载：几何按 src 查 rig，动效参数按情绪烘焙进来（同上，只有 ctx 是运行时）。 */
	const rigPayload = useMemo(() => {
		const built = buildRigAvatarPayload(preset.patient, snapshot);
		if (!preset.directSrc) return built;
		return { ...built, src: preset.directSrc, alt: preset.directAlt ?? built.alt };
	}, [preset, snapshot]);

	useEffect(() => () => audioEl?.pause(), [audioEl]);

	const playTrack = (key: string, src: string) => {
		const el = audioEl;
		if (!el) return;
		el.src = src;
		el.currentTime = 0;
		setTrack(key);
		void el.play().catch((err) => console.warn("[presentation-lab] 播放失败", err));
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
				subtitle="表现层试验台：只看动效效果，不参与评分与训练，不写任何业务数据。"
				icon={IconMovie}
			/>

			<Stack gap="lg">
				<Paper withBorder radius="lg" p="md">
					<Stack gap="md">
						<Box>
							<Text size="sm" fw={600} mb={6}>
								立绘（12 张：2 写实病例 + 8 年龄性别 + 2 护士素材）
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
								情绪（6 态）
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
								测试音频（本页播放，不经训练链路）
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
								label="减少动效（与系统偏好等效，强制静态）"
								checked={reducedMotion}
								onChange={(e) => setReducedMotion(e.currentTarget.checked)}
							/>
							<Switch
								label="手动模拟说话（不播音频也能看点头）"
								checked={manualSpeaking}
								onChange={(e) => setManualSpeaking(e.currentTarget.checked)}
							/>
						</Group>
					</Stack>
				</Paper>

				<SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
					<Panel title="静态" hint="与动效面板同一张图，reducedMotion=true">
						<PatientPresenter presentation={payload} fill reducedMotion />
					</Panel>
					<Panel
						title="M1 整图动效"
						hint={reducedMotion ? "减少动效已开 → 退化为静态" : speaking ? "呼吸 + 点头（幅度随包络）" : "仅呼吸"}
					>
						<PatientPresenter
							presentation={payload}
							fill
							speaking={speaking}
							envelope={envelope}
							reducedMotion={reducedMotion}
						/>
					</Panel>
					<Panel
						title="M2 自绘引擎"
						hint={reducedMotion ? "减少动效已开 → 退化为静态" : speaking ? "带状弯曲 + 眨眼 + 口型重绘" : "呼吸 + 眨眼"}
					>
						<PatientPresenter
							presentation={rigPayload}
							fill
							speaking={speaking}
							envelope={envelope}
							reducedMotion={reducedMotion}
						/>
					</Panel>
				</SimpleGrid>

				<Text size="xs" c="dimmed" ff="monospace">
					{payload.src}
				</Text>
			</Stack>
		</Container>
	);
}
