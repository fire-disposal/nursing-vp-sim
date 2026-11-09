import { Box, Button, Group, Stack, Text } from "@mantine/core";
import { IconArrowLeft, IconClipboardCheck } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import type { ClinicalJudgmentState } from "@/api/clinical-reasoning";
import { useConfirm } from "@/components/ui/confirm";
import { noticeCountLabel, objectiveTally } from "./evidence-model";

/**
 * 顶栏：一条**状态带**，不是工具栏。
 *
 * 只放四件事：离开、判断刻度（关键线索 N/M，每一段 = 一条线索）、计时、交卷。
 * 刻度用离散段点而不是百分比条 —— 学生一眼就能数出"还差几条"，比 62% 更能驱动下一条行动。
 * 交卷有确认、全程防重复提交，失败时错误就贴着按钮显示（不弹层盖住现场）。
 */
export function ControlBar({
	state,
	recordId,
	clock,
	expired,
	hasPendingWork,
	ending,
	endError,
	onEnd,
}: {
	state: ClinicalJudgmentState;
	recordId: string;
	clock: string;
	expired: boolean;
	hasPendingWork: boolean;
	ending: boolean;
	endError: string | null;
	onEnd: () => Promise<void>;
}) {
	const navigate = useNavigate();
	const { confirm } = useConfirm();
	const notice = noticeCountLabel(state);
	const tally = objectiveTally(state);

	const requestEnd = async () => {
		if (ending) return;
		const ok = await confirm({
			title: "结束本次训练？",
			message: hasPendingWork
				? "还有未完成的操作：正在送达的消息或正在执行的行动会被中断。交卷后不能继续对话或补充证据。"
				: "交卷后不能继续对话或补充证据，评分会依据你已确认的证据、完成的行动与传达的内容生成。",
			confirmLabel: "交卷并查看结果",
			cancelLabel: "继续训练",
		});
		if (!ok) return;
		await onEnd();
	};

	return (
		<Box component="header" className="cr-controlbar" px="md" style={{ borderBottom: "1px solid var(--ns-line)" }}>
			<Group justify="space-between" wrap="nowrap" h={52} gap="md">
				<Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
					<Button
						variant="subtle"
						color="gray"
						size="compact-xs"
						leftSection={<IconArrowLeft size={13} />}
						onClick={() => navigate(`/record/${recordId}`)}
						aria-label="先查看本次记录（训练继续）"
					>
						记录
					</Button>
					<Box
						aria-hidden
						style={{ width: 1, height: 16, background: "var(--ns-line)" }}
					/>
					<Stack gap={0} className="cr-controlbar-meta" style={{ minWidth: 0 }}>
						<Text className="cr-kicker" style={{ fontSize: 10 }}>
							临床判断 · 夜间当班
						</Text>
						<Text size="sm" fw={600} truncate lh={1.3}>
							{state.scenario.title || "证据工作台"}
						</Text>
					</Stack>
				</Group>

				<Group gap="md" wrap="nowrap" align="center">
					{notice && (
						<Stack gap={4} align="flex-end" aria-label={`关键线索 ${notice.done} / ${notice.total}`}>
							<Text size="xs" c="var(--ns-ink-dim)">
								关键线索 <Text span fw={700} c="var(--ns-amber-text)">{notice.done}</Text>/{notice.total}
							</Text>
							<Box className="cr-gauge" role="img" aria-hidden>
								{Array.from({ length: notice.total }, (_, index) => (
									<Box
										key={index}
										className="cr-gauge-seg"
										data-on={index < notice.done || undefined}
									/>
								))}
							</Box>
						</Stack>
					)}

					<Stack gap={0} align="flex-end" visibleFrom="md">
						<Text size="xs" c="var(--ns-ink-dim)">
							行动 {tally.actDone}/{tally.actTotal}
						</Text>
						<Text size="xs" c="var(--ns-ink-dim)">
							传达 {tally.communicateDone}/{tally.communicateTotal}
						</Text>
					</Stack>

					<Text
						size="sm"
						fw={700}
						c={expired ? "var(--ns-danger)" : "var(--ns-ink)"}
						aria-label={clock === "--:--" ? "不限时" : `剩余时间 ${clock}`}
					>
						{clock}
					</Text>

					<Button
						onClick={requestEnd}
						variant="light"
						color="orange"
						size="compact-sm"
						leftSection={<IconClipboardCheck size={14} />}
						loading={ending}
						disabled={ending}
					>
						{ending ? "交卷中…" : "结束训练"}
					</Button>
				</Group>
			</Group>
			{endError && (
				<Box className="cr-notice" data-tone="danger" role="alert" mb={8}>
					<Text size="xs" style={{ wordBreak: "break-word" }}>
						交卷失败：{endError}。已确认的证据与对话都保存在记录里，可以直接重试。
					</Text>
				</Box>
			)}
		</Box>
	);
}
