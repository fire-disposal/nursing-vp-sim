import { Badge, Box, Group, Modal, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useExamResults, usePatientData, useRecordFeatures, useTrainingData } from "@/engine/TrainingDataContext";
import { useIsMobile } from "@/hooks/useLayoutMode";
import { useTrainingStore } from "@/stores/trainingStore";
import { EmotionIndicator } from "./EmotionIndicator";
import { InquiryProgressChip } from "./InquiryProgressChip";
import PatientPresenter from "./presentation/PatientPresenter";
import { buildPatientPresentation } from "./presentation/build";

/** 桌面上下文列宽度：够读，不抢对话区 */
const CONTEXT_COLUMN_WIDTH = 248;

/** 可见呼吸状态 → 动画周期（秒）：只表达快慢，不给次数 */
const BREATH_SECONDS: Record<string, number> = { normal: 3, rapid: 1.9, labored: 1.5 };
/** 可见呼吸状态 → 学生看得懂的说法（与动画同时出现） */
const BREATH_LABELS: Record<string, string> = { normal: "平稳", rapid: "偏快", labored: "费力" };

/** 情绪 → 在场色（说话光环与呼吸条用它）：只做视觉关联，情绪文案仍由 EmotionIndicator 承担 */
const ACCENT_BY_EMOTION: Record<string, string> = {
	withdrawn: "indigo.4",
	defensive: "red.5",
	anxious: "orange.5",
	neutral: "brand.5",
	relaxed: "teal.5",
	open: "green.5",
};

/** 体征状态 → Mantine 色（与服务端 `interpretation.status` 同一语义：高/低 = 需注意） */
const VITAL_STATUS_COLOR: Record<string, string> = {
	high: "orange.6",
	low: "orange.6",
	normal: "green.6",
};

/**
 * PatientStage — **患者上下文**（训练三区布局的一级区域，观察对象）。
 *
 * 需求出发，而不是"一张占半屏的大图"：
 *
 * - 对话是主工作面，患者是**背景信息**：桌面 216px 常驻列（头像 / 姓名·年龄·性别 / 主诉 /
 *   已测体征 / 情绪），不展开、不折叠、不挤压对话列；
 * - 手机（< 768px）：一条患者条（头像 + 姓名 + 主诉 + 情绪），纵向空间全留给对话；
 * - **大图按需**：点头像/患者条打开浮层看患者形象——观察训练需要的表情与体态在那里，不在常驻区；
 * - 只显示**学生自己采集到的**体征（`useExamResults`）：未测量前不展示任何体征值，
 *   患者的生命体征是要"查"出来的信息，不是开局就摊在屏幕上的答案。
 */
export default function PatientStage() {
	const mobile = useIsMobile();
	const patient = usePatientData();
	const examResults = useExamResults();
	const features = useRecordFeatures();
	const record = useTrainingData();
	const recordId = Number(useTrainingStore((s) => s.recordId));
	const bus = useTrainingStore((s) => s.bus);
	const emotion = useTrainingStore((s) => s.emotion);
	const emotion4D = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);
	const [portraitOpen, setPortraitOpen] = useState(false);
	// 说话态：TTSManager 已在总线上发 tts:start/end（EmotionIndicator 也在用）→ 零新增管线
	const [speaking, setSpeaking] = useState(false);
	useEffect(() => {
		if (!bus) return;
		const offStart = bus.on("tts:start", () => setSpeaking(true));
		const offEnd = bus.on("tts:end", () => setSpeaking(false));
		return () => {
			offStart();
			offEnd();
		};
	}, [bus]);

	/**
	 * 呼吸节奏：**只给节奏，不给次数**。
	 * 次数（`vitals.rr`）是要靠床旁检查"查出来"的体征，印在屏幕上等于预支答案；
	 * "他呼吸有点费力"却是任何人一眼看得见的在场信息 —— 所以读病例声明的**定性**线索，转成动画周期。
	 */
	const breathing = useMemo(() => {
		const scene = record?.scene as { patient?: { breathing?: string } } | null | undefined;
		return scene?.patient?.breathing ?? null;
	}, [record]);
	const breathSeconds = breathing ? (BREATH_SECONDS[breathing] ?? BREATH_SECONDS.normal) : null;

	const values = useMemo(
		() => ({ trust, anxiety, irritation, cooperation }),
		[trust, anxiety, irritation, cooperation],
	);
	const presentation = useMemo(
		() => buildPatientPresentation(patient, { emotion, emotion4D, values }),
		[patient, emotion, emotion4D, values],
	);

	const accent = ACCENT_BY_EMOTION[emotion] ?? "brand.5";
	const name = patient?.name ?? "患者";
	const chiefComplaint = patient?.chiefComplaint ?? "";
	const identity = patient
		? [patient.age ? `${patient.age} 岁` : "", patient.gender === "male" ? "男" : patient.gender === "female" ? "女" : ""]
				.filter(Boolean)
				.join(" · ")
		: "";
	const vitals = examResults.filter((entry) => entry.value !== "");

	const portrait = (
		<Modal opened={portraitOpen} onClose={() => setPortraitOpen(false)} title={name} size={380} centered withinPortal>
			<Stack align="center" gap="sm">
				<Box w="100%">
					<PatientPresenter presentation={presentation} fill />
				</Box>
				{identity && (
					<Text size="sm" c="dimmed">
						{identity}
					</Text>
				)}
				{chiefComplaint && (
					<Text size="sm" ta="center" lh={1.6}>
						主诉：{chiefComplaint}
					</Text>
				)}
			</Stack>
		</Modal>
	);

	if (mobile) {
		return (
			<>
				<UnstyledButton
					data-patient-stage
					data-patient-mode="compact"
					data-patient-stage-head
					onClick={() => setPortraitOpen(true)}
					aria-label={`查看患者${name}`}
					p="xs"
					w="100%"
					style={{
						borderBottom: "1px solid var(--mantine-color-default-border)",
						background: "var(--mantine-color-body)",
						flexShrink: 0,
					}}
				>
					<Group gap="sm" wrap="nowrap">
						<Box pos="relative" style={{ flexShrink: 0 }}>
							<PatientPresenter presentation={presentation} size={36} rounded="full" />
							{speaking && (
								<Box
									className="patient-speaking-ring"
									pos="absolute"
									inset={-2}
									style={{ borderRadius: "50%", boxShadow: `0 0 0 2px var(--mantine-color-${accent})` }}
								/>
							)}
						</Box>
						<Box miw={0} flex={1}>
							{/* 第一行：姓名 · 年龄性别 + 采集进度（进度是"对这位患者问到多少"，与身份同一行不抢位） */}
							<Group gap={6} wrap="nowrap" justify="space-between">
								<Group gap={6} wrap="nowrap" miw={0}>
									<Text size="sm" fw={700} truncate>
										{name}
									</Text>
									{identity && (
										<Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
											{identity}
										</Text>
									)}
								</Group>
								<InquiryProgressChip />
							</Group>
							{/* 第二行：主诉 + 情绪（情绪是持续观察项，常驻） */}
							<Group gap={8} wrap="nowrap" mt={2}>
								{chiefComplaint && (
									<Text size="xs" c="dimmed" truncate flex={1}>
										主诉：{chiefComplaint}
									</Text>
								)}
								{bus && <EmotionIndicator bus={bus} features={features} recordId={recordId} compact />}
							</Group>
						</Box>
					</Group>
				</UnstyledButton>
				{portrait}
			</>
		);
	}

	return (
		<>
			<Stack
				component="aside"
				aria-label="患者信息"
				data-patient-stage
				data-patient-mode="full"
				gap="sm"
				p="sm"
				h="100%"
				bg="var(--mantine-color-body)"
				style={{
					width: CONTEXT_COLUMN_WIDTH,
					flexShrink: 0,
					borderRight: "1px solid var(--mantine-color-default-border)",
					overflowY: "auto",
				}}
			>
				<Paper withBorder radius="lg" p={6} pos="relative" bg="gray.0">
					{/* 固定 4:5 容器 + 裁切：抠图是竖构图，拉成任意比例会显得像贴纸（评审 B4） */}
					<Box pos="relative">
						<UnstyledButton
							data-patient-stage-head
							onClick={() => setPortraitOpen(true)}
							aria-label={`查看患者${name}的大图`}
							w="100%"
							style={{ display: "block", aspectRatio: "4 / 5", overflow: "hidden", borderRadius: "var(--mantine-radius-sm)" }}
						>
							<PatientPresenter presentation={presentation} fill />
						</UnstyledButton>
						{/* 说话态：光环 + 声波条（tts:start/end 驱动），不遮挡点击 */}
						{speaking && (
							<Box
								className="patient-speaking-ring"
								pos="absolute"
								inset={0}
								style={{ borderRadius: "var(--mantine-radius-sm)", boxShadow: `0 0 0 2px var(--mantine-color-${accent})` }}
							/>
						)}
						{speaking && (
							<Group gap={3} pos="absolute" bottom={10} left={10} align="flex-end" h={14}>
								{[0, 1, 2, 3].map((i) => (
									<Box
										key={i}
										className="patient-wave-bar"
										w={3}
										h="100%"
										bg={accent}
										style={{ borderRadius: 2, animationDelay: `${i * 0.11}s` }}
									/>
								))}
							</Group>
						)}
						<Badge
							size="xs"
							variant="filled"
							color="dark"
							pos="absolute"
							bottom={12}
							right={12}
							leftSection={<IconPhoto size={11} />}
						>
							看大图
						</Badge>
					</Box>
				</Paper>

				<Stack gap={0}>
					<Text size="sm" fw={700} truncate>
						{name}
					</Text>
					{identity && (
						<Text size="xs" c="dimmed">
							{identity}
						</Text>
					)}
				</Stack>

				{chiefComplaint && (
					<Stack gap={2}>
						<Text size="sm" fw={600} c="dimmed">
							主诉
						</Text>
						<Text size="xs" lh={1.55} lineClamp={4}>
							{chiefComplaint}
						</Text>
					</Stack>
				)}

				<Box>
					<InquiryProgressChip />
				</Box>

				{/* 呼吸节奏：只表达"快/慢"（在场可见信息），不印次数 —— 次数要靠床旁检查得到 */}
				{breathSeconds !== null && (
					<Group gap={6} wrap="nowrap" align="center">
						<Text size="11px" fw={600} c="dimmed">
							呼吸
						</Text>
						<Box
							className="patient-breath-bar"
							w={4}
							h={14}
							bg={accent}
							style={{ borderRadius: 2, animationDuration: `${breathSeconds}s` }}
						/>
						<Text size="xs" c="dimmed">
							{BREATH_LABELS[breathing ?? "normal"]}
							{speaking ? " · 正在说话" : ""}
						</Text>
					</Group>
				)}

				{/* 已测体征：只有学生真的测过才出现（没测 = 不知道，不预支答案） */}
				{vitals.length > 0 && (
					<Stack gap={2}>
						<Text size="sm" fw={600} c="dimmed">
							已测体征
						</Text>
						{vitals.map((entry) => (
							<Group key={entry.type} gap={6} wrap="nowrap">
								<Box w={6} h={6} bg={VITAL_STATUS_COLOR[entry.status ?? "normal"] ?? "gray.5"} style={{ borderRadius: 999, flexShrink: 0 }} />
								<Text size="xs" truncate style={{ fontVariantNumeric: "tabular-nums" }}>
									{entry.label || entry.type} {entry.value}
									{entry.unit ?? ""}
								</Text>
							</Group>
						))}
					</Stack>
				)}

				{bus && (
					<Box mt="auto">
						<EmotionIndicator bus={bus} features={features} recordId={recordId} compact />
					</Box>
				)}
			</Stack>
			{portrait}
		</>
	);
}
