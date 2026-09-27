import { Box, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import { ACTIVITY_LABELS } from "@/config/activity-display";
import {
	type ManifestBlocker,
	blockerActivity,
	completionBlockers,
	completionConditions,
	requiredArtifacts,
} from "@/engine/manifest";
import { useSessionManifest } from "@/engine/TrainingDataContext";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { activityStatus } from "./ActivityStatusBadge";

/**
 * 完成清单（docs/15 §五 硬规则 / §十五 陷阱 2）。
 *
 * 只渲染 `manifest.completion` 下发的 `conditions` / `blockers`：
 * 文案原样来自服务端，前端**不**计算能否结束（`eligible` 也不在本文件推导）。
 *
 * 这里是**流程与门禁信息的唯一去处**：对话列不再挂完成度条，开场卡也不再复述流程；
 * 学生要交卷时才需要知道"缺什么 / 要交什么 / 结束后看什么"。
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
function BlockerAction({ blocker, onNavigated }: { blocker: ManifestBlocker; onNavigated?: () => void }) {
	const manifest = useSessionManifest();
	const openPanel = useWorkspaceStore((state) => state.openPanel);
	const activity = blockerActivity(manifest, blocker);

	if (activity) {
		return (
			<Button
				variant="light"
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

/** 结束确认弹窗里的完成清单：条件逐条 + 阻塞原因（含跳转）+ 要交什么 + 结束后看什么。
 *
 * `onNavigated` 由弹窗宿主传入（关闭自己），否则「去处理」打开的面板会被弹窗遮住。
 */
export function CompletionChecklist({ onNavigated }: { onNavigated?: () => void }) {
	const manifest = useSessionManifest();

	const conditions = completionConditions(manifest);
	const blockers = completionBlockers(manifest);
	// 必交产物：kind 是服务端口径，展示名优先用同样来自 manifest 的 activity.label
	const required = requiredArtifacts(manifest).map((kind) => {
		const activity = manifest?.activities.find((item) => item.artifact_kind === kind);
		return {
			kind,
			label: activity?.label ?? ACTIVITY_LABELS[kind] ?? kind,
			status: activity ? activityStatus(activity, manifest?.artifacts[kind]) : null,
		};
	});

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
								color={condition.satisfied ? "var(--mantine-color-green-6)" : "var(--mantine-color-dimmed)"}
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
					<BlockerAction blocker={blocker} onNavigated={onNavigated} />
				</Group>
			))}

			<Stack gap={6} style={{ borderTop: "1px solid var(--mantine-color-default-border)", paddingTop: 10 }}>
				<Text size="xs" fw={600} c="dimmed">
					本病例要求提交的产物
				</Text>
				{required.length > 0 ? (
					<Text size="xs" c="dimmed" lh={1.6}>
						{required.map((item) => `${item.label}（${item.status?.label ?? "状态未下发"}）`).join("、")}
						，请在对应面板填写后点面板里的
						<Text component="span" fw={500} c="var(--mantine-color-text)">
							「提交」
						</Text>
						（草稿不算提交）。
					</Text>
				) : (
					<Text size="xs" c="dimmed">
						本病例没有额外要求提交的产物。
					</Text>
				)}
				<Text size="xs" c="dimmed" lh={1.6}>
					<Text component="span" fw={600} c="var(--mantine-color-text)">
						结束后：
					</Text>
					等待评分结果 → 在结果页先看「关键选择回看」，再看逐项判定与证据 → 最后填写反馈问卷。
				</Text>
			</Stack>
		</Stack>
	);
}
