import { Badge, Box, Group, Modal, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useExamResults, usePatientData, useRecordFeatures } from "@/engine/TrainingDataContext";
import { useIsMobile } from "@/hooks/useLayoutMode";
import { useTrainingStore } from "@/stores/trainingStore";
import { EmotionIndicator } from "./EmotionIndicator";
import PatientPresenter from "./presentation/PatientPresenter";
import { buildPatientPresentation } from "./presentation/build";

/** 桌面上下文列宽度：够读，不抢对话区 */
const CONTEXT_COLUMN_WIDTH = 216;

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
	const recordId = Number(useTrainingStore((s) => s.recordId));
	const bus = useTrainingStore((s) => s.bus);
	const emotion = useTrainingStore((s) => s.emotion);
	const emotion4D = useTrainingStore((s) => s.emotion4D);
	const trust = useTrainingStore((s) => s.trust);
	const anxiety = useTrainingStore((s) => s.anxiety);
	const irritation = useTrainingStore((s) => s.irritation);
	const cooperation = useTrainingStore((s) => s.cooperation);
	const [portraitOpen, setPortraitOpen] = useState(false);

	const values = useMemo(
		() => ({ trust, anxiety, irritation, cooperation }),
		[trust, anxiety, irritation, cooperation],
	);
	const presentation = useMemo(
		() => buildPatientPresentation(patient, { emotion, emotion4D, values }),
		[patient, emotion, emotion4D, values],
	);

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
						<PatientPresenter presentation={presentation} size={36} rounded="full" />
						<Box miw={0} flex={1}>
							<Group gap={6} wrap="nowrap">
								<Text size="sm" fw={700} truncate>
									{name}
								</Text>
								{identity && (
									<Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
										{identity}
									</Text>
								)}
							</Group>
							{chiefComplaint && (
								<Text size="xs" c="dimmed" truncate mt={2}>
									主诉：{chiefComplaint}
								</Text>
							)}
						</Box>
						{bus && <EmotionIndicator bus={bus} features={features} recordId={recordId} compact />}
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
				<Paper withBorder radius="lg" p={6} pos="relative">
					<UnstyledButton
						data-patient-stage-head
						onClick={() => setPortraitOpen(true)}
						aria-label={`查看患者${name}的大图`}
						w="100%"
					>
						<PatientPresenter presentation={presentation} fill />
					</UnstyledButton>
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
						<Text size="11px" fw={600} c="dimmed">
							主诉
						</Text>
						<Text size="xs" lh={1.55} lineClamp={4}>
							{chiefComplaint}
						</Text>
					</Stack>
				)}

				{/* 已测体征：只有学生真的测过才出现（没测 = 不知道，不预支答案） */}
				{vitals.length > 0 && (
					<Stack gap={2}>
						<Text size="11px" fw={600} c="dimmed">
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
