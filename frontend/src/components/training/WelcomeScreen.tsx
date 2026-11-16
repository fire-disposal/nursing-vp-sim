import { Fragment, type ReactNode, useMemo } from "react";
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
		<Box className="stu-welcome" px="xs" py="md" mx="auto" w="100%" maw={768}>
			<Card p={14}>
				<Stack gap={8}>
					<Text size="sm" c="dimmed" lh={1.6}>
						你是本病例的
						<Text component="span" fw={600} c="var(--mantine-color-text)">
							责任护士
						</Text>
						：先与患者对话采集病史，再完成工作区里的内容；完成后点右上角「结束训练」交卷。
					</Text>

					<Group className="stu-flow" gap={0} wrap="wrap" role="group" aria-label="本次训练步骤">
						<FlowStep index={1} label="问诊采集" state="current" />
						{flow.runnable.map((activity, i) => {
							const artifact = activity.artifact_kind ? manifest?.artifacts[activity.artifact_kind] : undefined;
							const status = activityStatus(activity, artifact);
							return (
								<Fragment key={activity.id}>
									<span className="stu-flow-sep" aria-hidden />
									<FlowStep
										index={i + 2}
										label={activity.label}
										state={status ? (status.color === "green" ? "done" : "current") : "todo"}
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
								</Fragment>
							);
						})}
						<span className="stu-flow-sep" aria-hidden />
						<FlowStep index={flow.runnable.length + 2} label="结束评分" state="todo" />
					</Group>

					{flow.unavailable.length > 0 && (
						<Text size="sm" c="dimmed" lh={1.6}>
							本次不可用：
							{flow.unavailable
								.map((activity) => `${activity.label}（${activityStatus(activity)?.label ?? "不可用"}）`)
								.join("、")}
						</Text>
					)}

					{showGuidance && onQuickPrompt && quickPrompts.length > 0 && (
						<Stack gap={8}>
							<Text size="sm" fw={600} c="dimmed">
								建议开场
							</Text>
							<Group gap={8} wrap="wrap">
								{quickPrompts.map((prompt) => (
									<button
										key={prompt}
										type="button"
										className="stu-suggest"
										onClick={() => onQuickPrompt(prompt)}
									>
										{prompt}
									</button>
								))}
							</Group>
						</Stack>
					)}
				</Stack>
			</Card>
		</Box>
	);
}

/** 流程步骤：编号点 + 名称（+ 徽章）。它不是按钮 —— 按钮只有「建议开场」。 */
function FlowStep({
	index,
	label,
	state = "todo",
	badges,
}: {
	index: number;
	label: string;
	state?: "todo" | "current" | "done";
	badges?: ReactNode;
}) {
	return (
		<span className="stu-flow-step" data-state={state}>
			<span className="stu-flow-num" aria-hidden>
				{index}
			</span>
			{label}
			{badges}
		</span>
	);
}
