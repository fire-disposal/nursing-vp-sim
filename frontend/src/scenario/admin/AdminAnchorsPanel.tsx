import { Badge, Box, Group, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import type {
	ScenarioAdminAnchorPanel,
	ScenarioAdminAnchorRejection,
	ScenarioAdminAnchorState,
	ScenarioAdminAnchorTurn,
} from "@/api/scenario";

/**
 * 会话回放里的**叙事锚点**面板（docs/21 §五 的投影口径）。
 *
 * 学生侧永远看不到这块：学生只看到世界（`cue` 必须被演出来）。这里给教师/管理员的是
 * **过程证据**——每个锚点此刻的阶段与状态、被世界卡在哪一步、引擎在哪几回合催办过、
 * DM 的哪些提案与重算不一致被拒了。状态不是另算的：它就是 `runtime/anchors.py` 的
 * 逐回合重算（`anchor_turns`），与提案裁决当时据以采纳/拒绝的那份同源。
 *
 * 标题写「叙事锚点」而不是「锚点」：会话列表里那列「锚点」是判读的强/合格/漏，两者
 * 不是一个东西，同一页上重名会让人以为是同一份数。
 *
 * 该病例没有声明锚点时后端给 `null` → **整块不渲染**（不是空表，也不是一行占位）。
 */
const STATUS: Record<string, { label: string; color: string }> = {
	pending: { label: "待推进", color: "gray" },
	active: { label: "推进中", color: "blue" },
	satisfied: { label: "已达成", color: "teal" },
	blocked: { label: "受阻", color: "orange" },
	abandoned: { label: "已放弃", color: "dark" },
};

/** 状态一律**文字 + 语义色**成对出现（只靠颜色等于没说）。未知状态原样显示，不吞掉。 */
function statusMeta(status: string): { label: string; color: string } {
	return STATUS[status] ?? { label: status, color: "gray" };
}

const NUDGE_MARK = ["①", "②", "③"];

/** 催办阶梯的等级标记（`overdue` 即阶梯的第几级，预算用尽的回合不会给 `nudge`）。 */
function nudgeLabel(overdue: number): string {
	return `催办${NUDGE_MARK[overdue - 1] ?? overdue}`;
}

function turnLabel(turn: number): string {
	return turn === 0 ? "开场" : `第 ${turn} 回合`;
}

/** 受阻原因与新提案的说明行（**同一段话**在"当前状态"与轨迹里都这么写）。 */
function blockedText(reason: string): string {
	return `受阻：缺 ${reason}`;
}

function rejectionText(rejection: ScenarioAdminAnchorRejection): string {
	return `被拒提案：提议「${rejection.proposal}」，重算为「${rejection.actual}」`;
}

/** 一次锚点被拒的提案（发生回合 + 提案名 vs 重算结果）。 */
function RejectionLines({
	rejections,
}: {
	rejections: ScenarioAdminAnchorRejection[];
}) {
	return (
		<>
			{rejections.map((rejection) => (
				<Text
					key={`${rejection.turn}-${rejection.proposal}`}
					size="xs"
					c="red.7"
				>
					{rejectionText(rejection)}
				</Text>
			))}
		</>
	);
}

/** 逐回合状态轨迹：一个锚点从开场到此刻，每回合末尾的状态 + 该回合的催办/被拒提案。 */
function AnchorTrajectory({
	turns,
	anchorId,
}: {
	turns: ScenarioAdminAnchorTurn[];
	anchorId: string;
}) {
	return (
		<Stack gap={4} px="xs" pb="xs">
			{turns.map((turn) => {
				const state = turn.states.find((item) => item.id === anchorId);
				if (!state) return null;
				const meta = statusMeta(state.status);
				const rejections = turn.rejected.filter(
					(item) => item.anchor_id === anchorId,
				);
				return (
					<Group key={turn.turn} gap="xs" wrap="wrap" align="baseline">
						<Text size="xs" c="dimmed" w={72} style={{ flexShrink: 0 }}>
							{turnLabel(turn.turn)}
						</Text>
						<Badge size="sm" variant="light" color={meta.color}>
							{meta.label}
						</Badge>
						{state.reason !== "" && (
							<Text size="xs" c="orange.7">
								{blockedText(state.reason)}
							</Text>
						)}
						{state.nudge !== "" && (
							<Badge size="sm" variant="light" color="yellow">
								{nudgeLabel(state.overdue)}
							</Badge>
						)}
						{state.nudge !== "" && (
							<Text
								size="xs"
								c="dimmed"
								lineClamp={1}
								title={state.nudge}
								maw={420}
							>
								{state.nudge}
							</Text>
						)}
						<RejectionLines rejections={rejections} />
					</Group>
				);
			})}
		</Stack>
	);
}

/** 一行锚点：id + 阶段 + 此刻状态（受阻写出缺的那一步）；点开是它的逐回合轨迹。 */
function AnchorRow({
	state,
	turns,
}: {
	state: ScenarioAdminAnchorState;
	turns: ScenarioAdminAnchorTurn[];
}) {
	const [open, setOpen] = useState(false);
	const meta = statusMeta(state.status);
	return (
		<Paper withBorder radius="sm">
			<UnstyledButton
				w="100%"
				p="xs"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-label={`锚点 ${state.id} 的逐回合状态`}
			>
				<Group justify="space-between" wrap="nowrap" gap="xs">
					<Box miw={0}>
						<Group gap={6} wrap="nowrap">
							<Text size="sm" fw={600}>
								{state.id}
							</Text>
							<Text size="xs" c="dimmed">
								{state.stage}
							</Text>
						</Group>
						<Text size="xs" c="dimmed" truncate>
							{state.goal}
						</Text>
					</Box>
					<Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
						{state.reason !== "" && (
							<Text size="xs" c="orange.7">
								{blockedText(state.reason)}
							</Text>
						)}
						<Badge variant="light" color={meta.color}>
							{meta.label}
						</Badge>
						{open ? (
							<IconChevronDown size={14} aria-hidden="true" />
						) : (
							<IconChevronRight size={14} aria-hidden="true" />
						)}
					</Group>
				</Group>
			</UnstyledButton>
			{open && <AnchorTrajectory turns={turns} anchorId={state.id} />}
		</Paper>
	);
}

export default function AdminAnchorsPanel({
	anchors,
}: {
	anchors?: ScenarioAdminAnchorPanel | null;
}) {
	if (anchors == null || anchors.turns.length === 0) return null;
	// "当前状态"取最后一回合：它与引擎此刻的判断同源（同一份重算的逐前缀结果）
	const latest = anchors.turns[anchors.turns.length - 1];
	return (
		<Box component="section" aria-label="叙事锚点">
			<Group justify="space-between" align="baseline" mb={4} gap="xs">
				<Text size="sm" fw={600}>
					叙事锚点（{anchors.count}）
				</Text>
				<Text size="xs" c="dimmed">
					状态由事件流重算 · 只在管理侧可见
				</Text>
			</Group>
			<Stack gap={6}>
				{latest.states.map((state) => (
					<AnchorRow key={state.id} state={state} turns={anchors.turns} />
				))}
			</Stack>
		</Box>
	);
}
