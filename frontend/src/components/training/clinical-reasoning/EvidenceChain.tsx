import { Box, Group, Stack, Text } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";
import { IconArrowUpRight, IconChecklist, IconStethoscope } from "@tabler/icons-react";
import type { ClinicalEvidence, ClinicalJudgmentState } from "@/api/clinical-reasoning";
import {
	EVIDENCE_KIND_LABEL,
	groupEvidenceByKind,
	noticeCountLabel,
} from "./evidence-model";
import { evidenceToneColor, evidenceToneStyle } from "./nightshift";

/**
 * 证据链：学生**真正拿到**的线索，按获取途径串成一条链。
 *
 * 图形层级（不靠图例也能读）：
 * - 实心脊线 + 途径色 + 途径名 = 已确认证据；点它可定位到产出它的那句话；
 * - 虚线空位 = 还没拿到的**数量**（不是内容）——只表示"这里还有缺口"，从不透露答案；
 * - 顶部刻度 `N/M 关键线索` 是唯一进度。
 *
 * 新证据由 `freshIds` 标记：一次性入场 + 脊线亮起 + 「新」印记（信息同时由该印记承担，
 * 关掉动画仍可辨认）。
 */
export function EvidenceChain({
	state,
	freshIds,
	linkedMessageId,
	onFocusMessage,
}: {
	state: ClinicalJudgmentState;
	freshIds: readonly string[];
	linkedMessageId: number | null;
	onFocusMessage: (messageId: number) => void;
}) {
	const groups = groupEvidenceByKind(state.evidence);
	const notice = noticeCountLabel(state);
	const freshSet = new Set(freshIds);
	const pendingCount = notice ? Math.max(0, notice.total - notice.done) : 0;

	return (
		<Stack gap={10}>
			<Group justify="space-between" align="baseline" wrap="nowrap">
				<Group gap={6} wrap="nowrap" align="center">
					<IconChecklist size={13} color="var(--ns-ink-faint)" aria-hidden />
					<Text className="cr-kicker">证据链</Text>
				</Group>
				<Text size="xs" c="var(--ns-ink-dim)">
					{notice ? `${notice.done} / ${notice.total} 关键线索` : `${state.evidence.length} 条`}
				</Text>
			</Group>

			{groups.length === 0 ? (
				<Box
					p="sm"
					style={{
						border: "1px dashed var(--ns-line)",
						borderRadius: 3,
						background: "var(--ns-stage)",
					}}
				>
					<Text size="sm" fw={550} mb={3}>
						还没有线索入袋
					</Text>
					<Text size="xs" c="var(--ns-ink-dim)" lh={1.55}>
						向患者提问，或在下方床旁操作坞里做一次评估。拿到的事实会一条条挂上这条链。
					</Text>
				</Box>
			) : (
				<Box className="cr-chain">
					{groups.map((group) => (
						<Box key={group.kind}>
							{/* 分组标题：小色块承担途径色，标题文字保持中性可读 */}
							<Group gap={5} mb={4} mt={group === groups[0] ? 0 : 4} align="center" wrap="nowrap">
								<Box
									aria-hidden
									style={{
										width: 8,
										height: 8,
										borderRadius: 1,
										background: evidenceToneColor(group.kind),
										flexShrink: 0,
									}}
								/>
								<Text className="cr-kicker">{group.label}</Text>
							</Group>
							<Stack gap={5}>
								{group.items.map((item) => (
									<ClueChip
										key={item.finding_id}
										evidence={item}
										fresh={freshSet.has(item.finding_id)}
										linked={linkedMessageId !== null && item.message_id === linkedMessageId}
										onFocusMessage={onFocusMessage}
									/>
								))}
							</Stack>
						</Box>
					))}
				</Box>
			)}

			{pendingCount > 0 && (
				<Box className="cr-pending">
					<Box className="cr-pending-dot" aria-hidden />
					<Text size="xs">
						还有 {pendingCount} 条关键线索待求证 —— 它们不会提前出现，靠你自己的获取。
					</Text>
				</Box>
			)}
		</Stack>
	);
}

/**
 * 线索卡可能是按钮（能定位到对话）或纯块（没有来源消息）。
 * 用一个极小的委托元素表达"二选一"，而不是把 Mantine 的 `Box as=` 硬套在带 `type` 的元素上
 * —— 后者在类型上不允许 `button` 的专属属性。
 */
interface TaggedProps {
	tag: "button" | "div";
	type?: "button";
	className?: string;
	style?: CSSProperties;
	onClick?: () => void;
	"aria-label"?: string;
	"data-fresh"?: boolean;
	"data-linked"?: boolean;
	children: ReactNode;
}

function Tagged({ tag, children, ...rest }: TaggedProps) {
	if (tag === "button") {
		return (
			<button type="button" {...rest}>
				{children}
			</button>
		);
	}
	return <div {...rest}>{children}</div>;
}

function ClueChip({
	evidence,
	fresh,
	linked,
	onFocusMessage,
}: {
	evidence: ClinicalEvidence;
	fresh: boolean;
	linked: boolean;
	onFocusMessage: (messageId: number) => void;
}) {
	const messageId = evidence.message_id;
	const canLocate = messageId !== undefined;
	return (
		<Tagged
			tag={canLocate ? "button" : "div"}
			type={canLocate ? "button" : undefined}
			className="cr-chip"
			data-fresh={fresh || undefined}
			data-linked={linked || undefined}
			style={{ ...evidenceToneStyle(evidence.kind), ...(canLocate ? {} : { cursor: "default" }) }}
			onClick={canLocate ? () => onFocusMessage(messageId) : undefined}
			aria-label={
				canLocate ? `已确认证据：${evidence.label}。定位到产出它的对话` : `已确认证据：${evidence.label}`
			}
		>
			<Box className="cr-chip-rail" aria-hidden />
			<Stack gap={1} style={{ minWidth: 0 }}>
				<Text className="cr-chip-kind">{EVIDENCE_KIND_LABEL[evidence.kind]}</Text>
				<Text className="cr-chip-label">{evidence.label}</Text>
				{evidence.note && <Text className="cr-chip-note">{evidence.note}</Text>}
			</Stack>
			<Box className="cr-chip-side">
				{fresh && <Text className="cr-fresh-mark">新</Text>}
				{canLocate && (
					<IconArrowUpRight size={13} color="var(--ns-ink-faint)" aria-hidden />
				)}
			</Box>
		</Tagged>
	);
}

/** 场景条：标题/地点压成一行可扫读的现场信息（不是一段简介）。 */
export function SceneBar({
	title,
	setting,
	summary,
	learnerBrief,
}: {
	title: string;
	setting: string;
	summary: string;
	learnerBrief: string;
}) {
	return (
		<Stack gap={8}>
			<Group gap={8} wrap="nowrap" align="baseline">
				<IconStethoscope size={13} color="var(--ns-ink-faint)" aria-hidden />
				<Text className="cr-kicker">现场</Text>
				{setting && (
					<Text size="xs" c="var(--ns-ink-dim)" truncate>
						{setting}
					</Text>
				)}
			</Group>
			<Stack gap={6}>
				<Text size="sm" fw={600} lh={1.45}>
					{title || "未命名场景"}
				</Text>
				{summary && (
					<Text size="xs" c="var(--ns-ink-dim)" lh={1.6}>
						{summary}
					</Text>
				)}
				{learnerBrief && (
					<Box
						mt={2}
						style={{
							borderLeft: "2px solid var(--ns-amber)",
							paddingLeft: 8,
						}}
					>
						<Text size="xs" c="var(--ns-ink)" lh={1.55}>
							{learnerBrief}
						</Text>
					</Box>
				)}
			</Stack>
		</Stack>
	);
}
