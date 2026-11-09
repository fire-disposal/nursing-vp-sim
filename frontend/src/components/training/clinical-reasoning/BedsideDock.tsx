import { Badge, Box, Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import {
	IconAlertTriangle,
	IconCircleCheck,
	IconHandStop,
	IconLock,
	IconMicroscope,
	IconRefresh,
	IconSpeakerphone,
} from "@tabler/icons-react";
import type {
	ClinicalAvailableFinding,
	ClinicalJudgmentState,
} from "@/api/clinical-reasoning";
import type { ClinicalActionError, PendingAction } from "./useClinicalReasoning";

/**
 * 床旁操作坞：**你现在能做的事**全在一处，按"评估 → 行动 → 沟通"三段排。
 *
 * 为什么不是右侧表单栏：这些动作是床旁现场的延伸（伸手去查、开口去说），所以用"动作位"
 * 的形式横排在患者镜框下方，而不是一列带输入控件的表单。
 *
 * 三种状态只靠形状区分（不看颜色也能读）：
 * - 虚线位 `data-state="available"`：还能获取的评估入口（可点"获取"）；
 * - 实线位 + 对勾：已完成的行动（不可点，是成绩单）；
 * - 实线位 + 锁：前置证据未齐的行动（不可执行，位上直接点名"还需证据：…"）；
 * - 沟通条目 + 方框：已传达/待传达。
 *
 * 隐藏证据不在这里；"还缺什么"只由服务端给的 `missing_findings` 文案呈现，
 * 前端不从病例原文里补答案。
 */
export function BedsideDock({
	state,
	pending,
	error,
	disabled,
	busy,
	onObserve,
	onAct,
	onRetry,
	onDismissError,
	onReload,
}: {
	state: ClinicalJudgmentState;
	pending: PendingAction | null;
	error: ClinicalActionError | null;
	/** 发送对话期间禁用动作：一次只推进一件事，避免动作与消息交错。 */
	disabled: boolean;
	busy: boolean;
	onObserve: (findingId: string) => void;
	onAct: (objectiveId: string) => void;
	/** 重试刚刚失败的那一步（保留同一幂等键）。 */
	onRetry: () => void;
	onDismissError: () => void;
	/** 只重读状态，不改世界。 */
	onReload: () => void;
}) {
	const findings: ClinicalAvailableFinding[] = state.available_findings;
	const actObjectives = state.objectives.must_act;
	const cues = state.objectives.must_communicate;
	const justCompleted = useJustCompleted(actObjectives);
	const blocked = disabled || busy;

	if (findings.length === 0 && actObjectives.length === 0 && cues.length === 0) {
		return (
			<Box className="cr-dock" px="md" py="sm" role="region" aria-label="床旁操作">
				<Text size="xs" c="var(--ns-ink-dim)">
					这一轮没有可执行的床旁操作 —— 回到对话继续。
				</Text>
			</Box>
		);
	}

	return (
		<Box className="cr-dock" px="md" py="sm" role="region" aria-label="床旁操作">
			{error && (
				<Box className="cr-notice" data-tone="danger" role="alert" mb="sm">
					<IconAlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
					<Stack gap={5} style={{ minWidth: 0 }}>
						<Text size="xs" style={{ wordBreak: "break-word" }}>
							{error.message}
						</Text>
						<Group gap={6}>
							<Button size="compact-xs" variant="light" color="orange" onClick={onRetry}>
								重试这一步
							</Button>
							<Button size="compact-xs" variant="subtle" color="gray" onClick={onDismissError}>
								忽略
							</Button>
						</Group>
					</Stack>
				</Box>
			)}

			<Group gap={10} align="flex-start" wrap="wrap">
				{/* ① 评估：还能获取的证据入口 */}
				<Group gap={6} wrap="wrap" align="center" style={{ flex: "1 1 320px", minWidth: 0 }}>
					<Group gap={4} wrap="nowrap" align="center" w="100%">
						<IconMicroscope size={12} color="var(--ns-ink-faint)" aria-hidden />
						<Text className="cr-kicker">评估</Text>
						<Text size="xs" c="var(--ns-ink-faint)">
							{findings.length} 个入口
						</Text>
					</Group>
					{findings.length === 0 ? (
						<Text size="xs" c="var(--ns-ink-dim)">
							暂无新的评估入口。
						</Text>
					) : (
						findings.map((finding) => {
							const running =
								pending?.kind === "observe" && pending.target === finding.finding_id;
							return (
								<Box
									key={finding.finding_id}
									className="cr-bay"
									data-state="available"
									style={{ flex: "1 1 240px", minWidth: 0 }}
								>
									<Box className="cr-bay-mark" aria-hidden>
										<IconMicroscope size={14} />
									</Box>
									<Stack gap={1} style={{ minWidth: 0 }}>
										<Text className="cr-bay-title">{finding.label}</Text>
										{finding.action && <Text className="cr-bay-hint">{finding.action}</Text>}
									</Stack>
									<Tooltip
										label={blocked ? "先完成手上的操作/等待回应" : finding.action || "获取"}
										withArrow
										position="top"
									>
										<span>
											<Button
												size="compact-xs"
												variant="light"
												color="teal"
												loading={running}
												disabled={blocked}
												onClick={() => onObserve(finding.finding_id)}
												aria-label={`获取 ${finding.label}`}
											>
												获取
											</Button>
										</span>
									</Tooltip>
								</Box>
							);
						})
					)}
				</Group>

				{/* ② 行动：必做的关键动作，完成即成型 */}
				{actObjectives.length > 0 && (
					<Group gap={6} wrap="wrap" align="center" style={{ flex: "1 1 300px", minWidth: 0 }}>
						<Group gap={4} wrap="nowrap" align="center" w="100%">
							<IconHandStop size={12} color="var(--ns-ink-faint)" aria-hidden />
							<Text className="cr-kicker">行动</Text>
							<Text size="xs" c="var(--ns-ink-faint)">
								{actObjectives.filter((item) => item.completed).length}/{actObjectives.length}
							</Text>
						</Group>
						{actObjectives.map((objective) => {
							const running = pending?.kind === "act" && pending.target === objective.id;
							// 前置证据未齐（服务端判定）：按钮不可执行，并把"还缺什么"写进位里 ——
							// 只靠 disabled 会变成"点了没反应"，学生无从知道下一步该去查什么。
							const locked = !objective.completed && !objective.available;
							const missing =
								objective.missing_findings.length > 0
									? objective.missing_findings.join("、")
									: "尚未采集完整（先做左侧评估）";
							return (
								<Box
									key={objective.id}
									className="cr-bay"
									data-state={objective.completed ? "done" : locked ? "locked" : "open"}
									data-just-completed={justCompleted.has(objective.id) || undefined}
									style={{ flex: "1 1 260px", minWidth: 0 }}
								>
									<Box className="cr-bay-mark" aria-hidden>
										{objective.completed ? (
											<IconCircleCheck size={15} />
										) : locked ? (
											<IconLock size={13} />
										) : (
											<IconHandStop size={14} />
										)}
									</Box>
									<Stack gap={1} style={{ minWidth: 0 }}>
										<Text className="cr-bay-title" c={objective.completed ? "var(--ns-ink-dim)" : undefined}>
											{objective.label}
										</Text>
										{objective.action && <Text className="cr-bay-hint">{objective.action}</Text>}
										{locked && (
											<Text className="cr-bay-hint" data-tone="locked">
												还需证据：{missing}
											</Text>
										)}
									</Stack>
									{objective.completed ? (
										<Badge size="xs" variant="light" color="teal" aria-label="已完成">
											已完成
										</Badge>
									) : (
										<Button
											size="compact-xs"
											variant="default"
											loading={running}
											disabled={blocked || locked}
											aria-disabled={locked || undefined}
											/* 前置证据未说明在位上（上面的 `还需证据：…`）；
											   禁用按钮自身 pointer-events: none，不能也不该靠它承载解释。 */
											title={locked ? `先获取证据：${missing}` : undefined}
											onClick={() => onAct(objective.id)}
											aria-label={`执行：${objective.label}`}
										>
											{locked ? "待评估" : "执行"}
										</Button>
									)}
								</Box>
							);
						})}
					</Group>
				)}

				{/* ③ 沟通：必须在对话里说清楚的内容（完成与否由服务端判定） */}
				{cues.length > 0 && (
					<Stack gap={5} style={{ flex: "1 1 260px", minWidth: 0 }}>
						<Group gap={4} wrap="nowrap" align="center">
							<IconSpeakerphone size={12} color="var(--ns-ink-faint)" aria-hidden />
							<Text className="cr-kicker">沟通</Text>
							<Text size="xs" c="var(--ns-ink-faint)">
								{cues.filter((item) => item.completed).length}/{cues.length}
							</Text>
						</Group>
						{cues.map((cue) => (
							<Box key={cue.id} className="cr-cue" data-done={cue.completed || undefined}>
								<Box className="cr-cue-box" aria-hidden>
									{cue.completed && <IconCircleCheck size={10} />}
								</Box>
								<Text size="xs" lh={1.5} style={{ flex: 1, minWidth: 0 }}>
									{cue.label}
								</Text>
								<Text size="xs" c="var(--ns-ink-faint)" style={{ flexShrink: 0 }}>
									{cue.completed ? "已传达" : "待传达"}
								</Text>
							</Box>
						))}
					</Stack>
				)}

				{/* 刷新：只重读状态，不改世界 */}
				<Button
					variant="subtle"
					color="gray"
					size="compact-xs"
					leftSection={<IconRefresh size={12} />}
					onClick={onReload}
					disabled={blocked}
					style={{ marginLeft: "auto" }}
					aria-label="刷新训练状态"
				>
					刷新
				</Button>
			</Group>
		</Box>
	);
}

/**
 * 目标完成状态的一次性确认：对比前后 `completed` 布尔值，返回"这一轮 未完成 → 已完成"的 id，
 * 1.8s 后清空。首次加载不算（一进页面全体亮起等于没有信号）。
 */
function useJustCompleted(
	objectives: ClinicalJudgmentState["objectives"]["must_act"],
): ReadonlySet<string> {
	const previousRef = useRef<Map<string, boolean> | null>(null);
	const [justCompleted, setJustCompleted] = useState<ReadonlySet<string>>(() => new Set());

	const signature = objectives.map((item) => `${item.id}:${item.completed ? 1 : 0}`).join("|");

	useEffect(() => {
		const next = new Map(objectives.map((item) => [item.id, item.completed]));
		const previous = previousRef.current;
		previousRef.current = next;
		if (previous === null) return;
		const flipped = objectives
			.filter((item) => item.completed && previous.get(item.id) === false)
			.map((item) => item.id);
		if (flipped.length === 0) return;
		setJustCompleted(new Set(flipped));
		const timer = window.setTimeout(() => setJustCompleted(new Set()), 1800);
		return () => window.clearTimeout(timer);
		// 用签名判断真实变化：`objectives` 每次状态更新都是新数组。
	}, [signature]);

	return justCompleted;
}
