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

/**
 * blocker → 动作。三态，都不自造状态：
 *  - 能定位到产出该产物的 Activity → 「去处理」按钮（打开面板）；
 *  - 服务端给了 `target` 但本端找不到对应 Activity → 不给按钮，明说需要手动打开；
 *  - `target` 为空（例如「训练已结束」）→ 不加动作，服务端文案本身已自洽。
 *
 * `onNavigated` 供宿主在跳转后收起自己：结束确认弹窗若不关闭，面板会被弹窗压住，
 * 「去处理」就等于没跳成（U0-B：一跳必须真的跳到位）。
 */
function BlockerAction({
	blocker,
	tone,
	onNavigated,
}: {
	blocker: ManifestBlocker;
	tone: "strip" | "dialog";
	onNavigated?: () => void;
}) {
	const manifest = useSessionManifest();
	const openPanel = useWorkspaceStore((state) => state.openPanel);
	const activity = blockerActivity(manifest, blocker);

	if (activity) {
		return (
			<Button
				variant={tone === "strip" ? "subtle" : "light"}
				size="compact-xs"
				onClick={() => {
					openPanel(activity.id);
					onNavigated?.();
				}}
			>
				去处理
			</Button>
		);
	}
	if (blocker.target) {
		return (
			<Text size="xs" c="dimmed">
				未能定位到对应面板，请手动打开处理
			</Text>
		);
	}
	return null;
}

/**
 * 对话区上方的完成度条：把「还差什么」放在学生视线内，
 * 而不是等点「结束训练」才被拒绝。
 */
export function CompletionStrip() {
	const manifest = useSessionManifest();
	const trainingEnded = useTrainingStore((state) => state.trainingEnded);

	const blockers = completionBlockers(manifest);
	const conditions = completionConditions(manifest);
	if (trainingEnded || (blockers.length === 0 && conditions.length === 0)) return null;

	return (
		<Box
			px="sm"
			py={6}
			style={{
				borderTop: "1px solid var(--mantine-color-default-border)",
				background: "var(--mantine-color-default-hover)",
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
							<BlockerAction blocker={blocker} tone="strip" />
						</Group>
					))
				)}
			</Group>
		</Box>
	);
}

/** 结束确认弹窗里的完成清单：条件逐条 + 阻塞原因（含跳转）。
 *
 * `onNavigated` 由弹窗宿主传入（关闭自己），否则「去处理」打开的面板会被弹窗遮住。
 */
export function CompletionChecklist({ onNavigated }: { onNavigated?: () => void }) {
	const manifest = useSessionManifest();

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
										: "var(--mantine-color-dimmed)"
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
					<BlockerAction blocker={blocker} tone="dialog" onNavigated={onNavigated} />
				</Group>
			))}
		</Stack>
	);
}
