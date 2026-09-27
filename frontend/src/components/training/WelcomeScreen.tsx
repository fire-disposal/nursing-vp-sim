import { type ReactNode, useMemo } from "react";
import { Badge, Box, Group, Stack, Text } from "@mantine/core";
import { Card } from "@/components/ui/card";
import { availableActivities, requiredArtifacts } from "@/engine/manifest";
import { useRecordMeta, useSessionManifest } from "@/engine/TrainingDataContext";
import type { PatientData } from "@/engine/types";
import { activityStatus } from "./workspace/ActivityStatusBadge";
import { getGuidedQuickPrompts } from "./quick-prompts";

interface WelcomeScreenProps {
	patient: PatientData;
	onQuickPrompt?: (text: string) => void;
}

/**
 * WelcomeScreen — 开场的**任务卡**（对话流的第一条，不是说明书）。
 *
 * 只留三件在开场真正需要的事：你的角色、本次要走的步骤（含必交与状态）、现在缺什么。
 * 「必交产物明细 / 如何交卷 / 结束后看什么」属于**动作时**才需要的信息，放在「完成清单」弹窗里
 * （点右上角结束训练打开）——开场不再用六段说明文字把对话流顶下去。
 *
 * 患者身份（头像/姓名/主诉）由患者上下文列或患者条承担，这里不重复。
 * 「要交什么 / 交没交 / 还缺什么」一律读 manifest，前端不推导完成条件。
 */
export function WelcomeScreen({ patient, onQuickPrompt }: WelcomeScreenProps) {
	const { mode } = useRecordMeta();
	const manifest = useSessionManifest();
	const showGuidance = mode === "guided";

	// 流程 = 服务端下发的可用活动（顺序即 ui.order）；不可用的另起一行说明原因
	const flow = useMemo(() => {
		const runnable = availableActivities(manifest);
		const runnableIds = new Set(runnable.map((activity) => activity.id));
		return {
			runnable,
			unavailable: manifest?.activities.filter((activity) => !runnableIds.has(activity.id)) ?? [],
		};
	}, [manifest]);

	const requiredKinds = useMemo(() => requiredArtifacts(manifest), [manifest]);
	const quickPrompts = useMemo(() => getGuidedQuickPrompts(patient), [patient]);

	return (
		<Box px="xs" py="md" mx="auto" w="100%" maw={768}>
			<Card p="md">
				<Stack gap="sm">
					<Text size="sm" c="dimmed" lh={1.6}>
						你是本病例的
						<Text component="span" fw={600} c="var(--mantine-color-text)">
							责任护士
						</Text>
						：先与患者对话采集病史，再完成工作区里的内容；完成后点右上角「结束训练」交卷。
					</Text>

					<Group gap={8} wrap="wrap">
						<FlowChip index={1} label="问诊采集" />
						{flow.runnable.map((activity, i) => {
							const artifact = activity.artifact_kind ? manifest?.artifacts[activity.artifact_kind] : undefined;
							const status = activityStatus(activity, artifact);
							return (
								<FlowChip
									key={activity.id}
									index={i + 2}
									label={activity.label}
									badges={
										<>
											{activity.artifact_kind !== null && requiredKinds.includes(activity.artifact_kind) && (
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
						<Text size="xs" c="dimmed" lh={1.6}>
							本次不可用：
							{flow.unavailable
								.map((activity) => `${activity.label}（${activityStatus(activity)?.label ?? "不可用"}）`)
								.join("、")}
						</Text>
					)}

					{showGuidance && onQuickPrompt && quickPrompts.length > 0 && (
						<Stack gap={6}>
							<Text size="xs" fw={600} c="dimmed">
								建议开场
							</Text>
							<Group gap={8} wrap="wrap">
							{quickPrompts.map((prompt) => (
								<FlowChip key={prompt} label={prompt} onClick={() => onQuickPrompt(prompt)} />
								))}
							</Group>
						</Stack>
					)}
				</Stack>
			</Card>
		</Box>
	);
}

/** 流程芯片：序号 + 名称 +（可选）徽章；`onClick` 给出时是建议开场的可点问句。 */
function FlowChip({
	index,
	label,
	badges,
	onClick,
}: {
	index?: number;
	label: string;
	badges?: ReactNode;
	onClick?: () => void;
}) {
	return (
		<Badge
			component={onClick ? "button" : "div"}
			onClick={onClick}
			variant={onClick ? "outline" : "light"}
			color={onClick ? "brand" : "gray"}
			size="lg"
			radius="xl"
			px={12}
			style={onClick ? { cursor: "pointer", textTransform: "none" } : { textTransform: "none" }}
		>
			<Group gap={6} wrap="nowrap">
				{index !== undefined && (
					<Text component="span" size="xs" fw={700} c="dimmed">
						{index}
					</Text>
				)}
				<Text component="span" size="xs" fw={500}>
					{label}
				</Text>
				{badges}
			</Group>
		</Badge>
	);
}
