import { type ReactNode, useMemo } from "react";
import { Avatar, Badge, Box, Group, Stack, Text } from "@mantine/core";
import { Card } from "@/components/ui/card";
import { ACTIVITY_LABELS } from "@/config/activity-display";
import { availableActivities, completionBlockers, requiredArtifacts } from "@/engine/manifest";
import { useRecordMeta, useSessionManifest } from "@/engine/TrainingDataContext";
import { useTrainingStore } from "@/stores/trainingStore";
import type { PatientData } from "@/engine/types";
import { getPatientAvatar, safeAvatarUrl } from "@/utils/avatar";
import { activityStatus } from "./workspace/ActivityStatusBadge";
import { getGuidedQuickPrompts } from "./quick-prompts";

interface WelcomeScreenProps {
	patient: PatientData;
	onQuickPrompt?: (text: string) => void;
}

/**
 * WelcomeScreen — 问诊开场：患者卡片 + 步骤语义 + 交卷与复盘路径。
 *
 * 「要交什么 / 交没交 / 还缺什么」一律读 manifest（`requiredArtifacts` /
 * `completionBlockers` / `activities[].availability` / `artifacts[].state`），
 * 前端不推导完成条件；manifest 未到位时只说与状态无关的角色与路径。
 * 「结束后会看到什么」是流程的固定描述（docs/19 §3.2），不是本次训练的状态。
 */
export function WelcomeScreen({ patient, onQuickPrompt }: WelcomeScreenProps) {
	const portraitUrl = useTrainingStore((s) => s.portraitUrl);
	const { mode } = useRecordMeta();
	const manifest = useSessionManifest();
	const showGuidance = mode === "guided";
	const fallbackAvatar = getPatientAvatar({ name: patient.name, gender: patient.gender });
	const avatarSrc = safeAvatarUrl(portraitUrl, fallbackAvatar);

	const genderLabel = patient.gender === "male" ? "男" : "女";
	const ageLabel = patient.age ? `${patient.age}岁` : "";
	const subInfo = [genderLabel, ageLabel].filter(Boolean).join(" · ");

	// 流程 = 服务端下发的可用活动（顺序即 ui.order）；不可用的另起一行说明原因
	const flow = useMemo(() => {
		const runnable = availableActivities(manifest);
		const runnableIds = new Set(runnable.map((activity) => activity.id));
		return {
			runnable,
			unavailable: manifest?.activities.filter((activity) => !runnableIds.has(activity.id)) ?? [],
		};
	}, [manifest]);

	// 必交产物：kind 是服务端口径，展示名优先用同样来自 manifest 的 activity.label
	const required = useMemo(
		() =>
			requiredArtifacts(manifest).map((kind) => {
				const activity = manifest?.activities.find((item) => item.artifact_kind === kind);
				return {
					kind,
					label: activity?.label ?? ACTIVITY_LABELS[kind] ?? kind,
					status: activity ? activityStatus(activity, manifest?.artifacts[kind]) : null,
				};
			}),
		[manifest],
	);

	// 未满足的完成条件：文案原样来自服务端 blocker.message（与完成条同一口径）
	const blockers = completionBlockers(manifest);

	const quickPrompts = useMemo(
		() => getGuidedQuickPrompts(patient),
		[patient],
	);

	return (
		<Box px="xs" py="md" mx="auto" w="100%" maw={768}>
			<Card p={{ base: "md", sm: "xl" }}>
				<Stack gap="lg">
					{/* 患者卡：头像背板 + 姓名 + 主诉 */}
					<Group gap="md" wrap="nowrap" align="center">
						<Box
							style={{
								borderRadius: "var(--mantine-radius-lg)",
								padding: 10,
								background:
									"radial-gradient(120% 100% at 50% 0%, var(--mantine-color-brand-light) 0%, var(--mantine-color-body) 75%)",
								border: "1px solid var(--mantine-color-brand-outline)",
								flexShrink: 0,
							}}
						>
							<Avatar src={avatarSrc} alt={patient.name} size={64} radius="lg" />
						</Box>
						<Box style={{ minWidth: 0 }}>
							<Text fw={700} size="lg" lh={1.3} truncate>
								{patient.name}
							</Text>
							<Group gap={6} mt={2} wrap="nowrap">
								<Text size="sm" c="dimmed">
									{subInfo}
								</Text>
								{patient.chiefComplaint && (
									<Badge
										variant="light"
										color="brand"
										size="sm"
										style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
									>
										主诉：{patient.chiefComplaint}
									</Badge>
								)}
							</Group>
						</Box>
					</Group>

					{/* 你的角色 */}
					<Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
						你是本病例的<Text component="span" fw={600} c="var(--mantine-color-text)">责任护士</Text>：先与患者对话采集病史，再按本病例要求完成工作区里的内容。
					</Text>

					{/* 训练流程：有 manifest 时按服务端活动列步骤，并标出必交与当前状态 */}
					<Stack gap={6}>
						<Group gap={8} wrap="wrap">
							<FlowChip index={1} label="问诊采集" />
							{flow.runnable.map((activity, i) => {
								const artifact = activity.artifact_kind ? manifest?.artifacts[activity.artifact_kind] : undefined;
								const status = activityStatus(activity, artifact);
								const mustSubmit =
									activity.artifact_kind !== null && required.some((item) => item.kind === activity.artifact_kind);
								return (
									<FlowChip
										key={activity.id}
										index={i + 2}
										label={activity.label}
										badges={
											<>
												{mustSubmit && (
													<Badge variant="light" color="brand" size="xs">
														必交
													</Badge>
												)}
												{status && (
													<Badge variant="light" color={status.color} size="xs">
														{status.label}
													</Badge>
												)}
											</>
										}
									/>
								);
							})}
							<FlowChip index={flow.runnable.length + 2} label="结束评分" />
						</Group>
						{flow.unavailable.length > 0 && (
							<Text size="xs" c="dimmed" style={{ lineHeight: 1.6 }}>
								本次不可用：
								{flow.unavailable
									.map((activity) => {
										const status = activityStatus(activity);
										return `${activity.label}（${status?.label ?? "不可用"}）`;
									})
									.join("、")}
							</Text>
						)}
					</Stack>

					{/* 交卷前还缺什么：只在服务端给出 blocker 时出现，不凭空声称状态 */}
					{blockers.length > 0 && (
						<Stack gap={4}>
							<Text size="xs" fw={600} c="dimmed">
								还缺什么
							</Text>
							{blockers.map((blocker, i) => (
								<Text key={`${blocker.code}-${i}`} size="xs" c="orange" style={{ lineHeight: 1.6 }}>
									{blocker.message}
								</Text>
							))}
						</Stack>
					)}

					{/* 交卷方式与结束后看到什么（流程的固定描述，非本次状态） */}
					<Stack
						gap={6}
						style={{ borderTop: "1px solid var(--mantine-color-default-border)", paddingTop: 12 }}
					>
						{manifest !== null && (
							<Text size="xs" c="dimmed" style={{ lineHeight: 1.6 }}>
								{required.length > 0 ? (
									<>
										<Text component="span" fw={600} c="var(--mantine-color-text)">本病例要求提交的产物：</Text>
										{required
											.map((item) => `${item.label}（${item.status?.label ?? "状态未下发"}）`)
											.join("、")}
										，请在对应面板填写后点面板里的
										<Text component="span" fw={500} c="var(--mantine-color-text)">「提交」</Text>
										（草稿不算提交）。
									</>
								) : (
									"本病例没有额外要求提交的产物。"
								)}
							</Text>
						)}
						<Text size="xs" c="dimmed" style={{ lineHeight: 1.6 }}>
							<Text component="span" fw={600} c="var(--mantine-color-text)">如何交卷：</Text>
							完成后点右上角
							<Text component="span" fw={500} c="var(--mantine-color-text)">「结束训练」</Text>
							；条件没满足时会被拦下，并逐条告诉你还缺什么。
						</Text>
						<Text size="xs" c="dimmed" style={{ lineHeight: 1.6 }}>
							<Text component="span" fw={600} c="var(--mantine-color-text)">结束后：</Text>
							等待评分结果 → 在结果页先看
							<Text component="span" fw={500} c="var(--mantine-color-text)">「关键选择回看」</Text>
							，再看逐项判定与证据 → 最后填写反馈问卷。
						</Text>
					</Stack>

					{/* 建议开场放在最后：手机首屏要留给「要做什么 / 还缺什么 / 如何交卷 / 之后看什么」，
					    开场问句是可选帮助，不该把契约挤出首屏（390x844 实测）。 */}
					{showGuidance && onQuickPrompt && (
						<Box>
							<Text size="xs" fw={600} c="dimmed" mb={8}>
								建议开场
							</Text>
							<Group gap={8} wrap="wrap">
								{quickPrompts.map((prompt) => (
									<Box
										key={prompt}
										component="button"
										type="button"
										onClick={() => onQuickPrompt(prompt)}
										style={{
											borderRadius: 999,
											border: "1px solid var(--mantine-color-brand-outline)",
											background: "var(--mantine-color-brand-light)",
											padding: "7px 14px",
											textAlign: "left",
											fontSize: 12,
											color: "var(--mantine-color-brand-light-color)",
											cursor: "pointer",
											transition: "background 120ms ease, border-color 120ms ease",
										}}
										onMouseEnter={(e) => { e.currentTarget.style.background = "var(--mantine-color-brand-light-hover)"; }}
										onMouseLeave={(e) => { e.currentTarget.style.background = "var(--mantine-color-brand-light)"; }}
									>
										{prompt}
									</Box>
								))}
							</Group>
						</Box>
					)}
				</Stack>
			</Card>
		</Box>
	);
}

/** 流程步骤 chip：序号 + 名称 + 可选状态徽章（视觉沿用原有胶囊样式）。 */
function FlowChip({
	index,
	label,
	badges,
}: {
	index: number;
	label: string;
	badges?: ReactNode;
}) {
	return (
		<Group
			gap={6}
			wrap="nowrap"
			style={{
				borderRadius: 999,
				border: "1px solid var(--mantine-color-default-border)",
				background: "var(--mantine-color-default-hover)",
				padding: "3px 10px 3px 6px",
			}}
		>
			<Box
				w={18}
				h={18}
				style={{
					borderRadius: 999,
					background: "var(--mantine-primary-color-filled)",
					color: "var(--mantine-primary-color-contrast)",
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					fontSize: 11,
					fontWeight: 700,
					fontVariantNumeric: "tabular-nums",
				}}
			>
				{index}
			</Box>
			<Text size="xs" c="dimmed" fw={500}>
				{label}
			</Text>
			{badges}
		</Group>
	);
}
