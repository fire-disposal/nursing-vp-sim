import { Box, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import {
	type ManifestBlocker,
	blockerActivity,
	completionBlockers,
	completionConditions,
} from "@/engine/manifest";
import { useSessionManifest } from "@/engine/TrainingDataContext";
import { useTrainingStore } from "@/stores/trainingStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * 完成条件展示（docs/15 §五 硬规则 / §十五 陷阱 2）。
 *
 * 只渲染 `manifest.completion` 下发的 `conditions` / `blockers`：
 * 文案原样来自服务端，前端**不**计算能否结束（`eligible` 也不在本文件推导）。
 */

/** blocker → 「去处理」动作：打开产出该产物的面板；无落点时不给按钮。 */
function useBlockerHandler() {
	const manifest = useSessionManifest();
	const openPanel = useWorkspaceStore((state) => state.openPanel);
	return (blocker: ManifestBlocker) => {
		const activity = blockerActivity(manifest, blocker);
		if (activity) openPanel(activity.id);
	};
}

/**
 * 对话区上方的完成度条：把「还差什么」放在学生视线内，
 * 而不是等点「结束训练」才被拒绝。
 */
export function CompletionStrip() {
	const manifest = useSessionManifest();
	const trainingEnded = useTrainingStore((state) => state.trainingEnded);
	const handleBlocker = useBlockerHandler();

	const blockers = completionBlockers(manifest);
	const conditions = completionConditions(manifest);
	if (trainingEnded || (blockers.length === 0 && conditions.length === 0)) return null;

	return (
		<Box
			px="sm"
			py={6}
			style={{
				borderTop: "1px solid var(--mantine-color-default-border)",
				background: "var(--mantine-color-gray-0)",
				flexShrink: 0,
			}}
		>
			<Group gap={8} wrap="wrap" justify="center">
				{blockers.length === 0 ? (
					<Group gap={6} wrap="nowrap">
						<IconCircleCheck size={14} color="var(--mantine-color-green-6)" />
						<Text size="xs" c="green">
							完成条件已满足，可结束训练
						</Text>
					</Group>
				) : (
					blockers.map((blocker) => (
						<Group key={blocker.code} gap={6} wrap="nowrap">
							<IconAlertCircle size={14} color="var(--mantine-color-orange-6)" />
							<Text size="xs" c="dimmed">
								{blocker.message}
							</Text>
							{blocker.target && (
								<Button variant="subtle" size="compact-xs" onClick={() => handleBlocker(blocker)}>
									去处理
								</Button>
							)}
						</Group>
					))
				)}
			</Group>
		</Box>
	);
}

/** 结束确认弹窗里的完成清单：条件逐条 + 阻塞原因（含跳转）。 */
export function CompletionChecklist() {
	const manifest = useSessionManifest();
	const handleBlocker = useBlockerHandler();

	const conditions = completionConditions(manifest);
	const blockers = completionBlockers(manifest);

	return (
		<Stack gap="sm">
			{conditions.length > 0 && (
				<Stack gap={6}>
					<Text size="xs" fw={600} c="dimmed">
						完成条件
					</Text>
					{conditions.map((condition) => (
						<Group key={condition.id} gap={8} wrap="nowrap">
							<IconCircleCheck
								size={14}
								color={
									condition.satisfied
										? "var(--mantine-color-green-6)"
										: "var(--mantine-color-gray-4)"
								}
							/>
							<Text size="sm" c={condition.satisfied ? undefined : "dimmed"}>
								{condition.label}
							</Text>
							<Text size="xs" c={condition.satisfied ? "green" : "orange"}>
								{condition.satisfied ? "已完成" : "未完成"}
							</Text>
						</Group>
					))}
				</Stack>
			)}

			{blockers.map((blocker) => (
				<Group key={blocker.code} gap={8} wrap="nowrap" align="flex-start">
					<IconAlertCircle size={14} color="var(--mantine-color-orange-6)" style={{ marginTop: 2 }} />
					<Box style={{ flex: 1, minWidth: 0 }}>
						<Text size="sm">{blocker.message}</Text>
					</Box>
					{blocker.target && (
						<Button variant="light" size="compact-xs" onClick={() => handleBlocker(blocker)}>
							去处理
						</Button>
					)}
				</Group>
			))}
		</Stack>
	);
}
