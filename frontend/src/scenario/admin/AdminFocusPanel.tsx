import {
	Badge,
	Box,
	Code,
	Group,
	Paper,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import type {
	ScenarioAdminFocusTurn,
	ScenarioAdminTurnReplay,
} from "@/api/scenario";

/**
 * 会话回放里的两块**过程证据**（docs/23 §6、§7.1、§7.7）：
 *
 * 1. **教学关注点投影**（`focus`）：每个时间单位边界重算一次的「相关 / 已处理」+ 证据引用。它不是
 *    已删除的锚点状态机（历史）：没有唯一 active、没有推进权、没有催办；`addressed` 只是本包声明的观察条件
 *    成立（本包确实看到了处理证据），**不等于学生能力达标**。同一块文字在界面上必须这么写。
 * 2. **逐时间单位来源回放**（`turns`）：一条已提交请求的「解析 → 结算 → 交付」流水。这里展示的是
 *    **记录下来的阶段产物**（学生输入原文、模型解析结果、确定性结算、最终交付、拒绝原因），
 *    不是模型的自述思考过程——标签一律用「解析结果 / 结算 / 交付」，不许写成"思考"。
 *
 * 学生侧永远看不到这两块（`focus` / `resolved` / `intent` / `problems` 都不出学生接口）。
 */

/** 关注点投影的一项：生成物没有单独导出这个别名，从时间单位类型派生（少一处手工镜像）。 */
type FocusState = NonNullable<ScenarioAdminFocusTurn["states"]>[number];
/** 回放里的三段产物与调用计数：同样从回放类型派生，避免给 `api/scenario.ts` 再加别名。 */
type TurnInputEcho = ScenarioAdminTurnReplay["input"];
type ResolvedTurn = NonNullable<ScenarioAdminTurnReplay["resolved"]>;
type SceneDelivery = NonNullable<ScenarioAdminTurnReplay["delivery"]>;
type ModelsUsed = NonNullable<ScenarioAdminTurnReplay["models"]>;
type AppliedEffect = NonNullable<ResolvedTurn["effects"]>[number];
type DeliveryMessage = NonNullable<SceneDelivery["messages"]>[number];

const INPUT_KIND: Record<string, string> = {
	speech: "说话",
	action: "行动",
	hint: "求提示",
};

const OUTCOME: Record<string, { label: string; color: string }> = {
	speech: { label: "纯交流", color: "gray" },
	performed: { label: "动作生效", color: "teal" },
	blocked: { label: "世界阻止", color: "orange" },
	unmodeled: { label: "本包未建模", color: "yellow" },
	clarification: { label: "澄清（不结算）", color: "gray" },
	hint: { label: "求提示（不推进）", color: "gray" },
};

function outcomeMeta(outcome: string): { label: string; color: string } {
	return OUTCOME[outcome] ?? { label: outcome, color: "gray" };
}

function turnLabel(turn: number): string {
	return turn === 0 ? "开场（时间 0）" : `时间单位 ${turn}`;
}

/** 状态改动的旧值 / 新值读数（`undefined` 与空串都写出来，不假装是 0 或 "无变化"）。 */
function valueText(value: unknown): string {
	if (value === undefined) return "（无）";
	if (typeof value === "string") return value === "" ? "（空）" : value;
	if (value === null || typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}

/** 一次状态改动：来源 + 键 + 旧值 → 新值。 */
function effectText(effect: AppliedEffect): string {
	const op = effect.op === "" ? "" : `${effect.op} `;
	return `${op}${effect.key}：${valueText(effect.old)} → ${valueText(effect.new)}`;
}

/** 回放的一个阶段：小标题 +（可选）口径说明 + 只读内容。 */
function Stage({
	label,
	note,
	children,
}: {
	label: string;
	note?: string;
	children: React.ReactNode;
}) {
	return (
		<Box component="section">
			<Group gap={6} align="baseline" mb={2} wrap="wrap">
				<Text size="xs" fw={600}>
					{label}
				</Text>
				{note !== undefined && (
					<Text size="xs" c="dimmed">
						{note}
					</Text>
				)}
			</Group>
			{children}
		</Box>
	);
}

/** 关注点的一行：id + 相关 / 已处理（文字与颜色成对，不靠颜色单独表意）+ 意图 + 证据引用。 */
function FocusStateRow({ state }: { state: FocusState }) {
	const evidence = state.evidence_refs ?? [];
	return (
		<Box miw={0}>
			<Group gap={6} wrap="wrap">
				<Code>{state.id}</Code>
				<Badge
					size="xs"
					variant={state.relevant ? "light" : "outline"}
					color={state.relevant ? "blue" : "gray"}
				>
					{state.relevant ? "相关" : "不相关"}
				</Badge>
				<Badge
					size="xs"
					variant={state.addressed ? "light" : "outline"}
					color={state.addressed ? "teal" : "gray"}
				>
					{state.addressed ? "已处理" : "未处理"}
				</Badge>
			</Group>
			{state.intent !== "" && <Text size="xs">{state.intent}</Text>}
			<Text size="xs" c="dimmed">
				证据：{evidence.length === 0 ? "无" : evidence.join("、")}
			</Text>
		</Box>
	);
}

/** 一个时间单位的关注点快照（点开看它的相关 / 已处理与证据）。 */
function FocusTurnRow({ turn, states }: { turn: number; states: FocusState[] }) {
	const [open, setOpen] = useState(false);
	const relevant = states.filter((state) => state.relevant).length;
	const addressed = states.filter((state) => state.addressed).length;
	return (
		<Paper withBorder radius="sm">
			<UnstyledButton
				w="100%"
				p="xs"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-label={`${turnLabel(turn)} 的教学关注点投影`}
			>
				<Group justify="space-between" wrap="nowrap" gap="xs">
					<Group gap="xs" wrap="wrap">
						<Text size="sm" fw={600}>
							{turnLabel(turn)}
						</Text>
						<Text size="xs" c="dimmed">
							{states.length} 个关注点
						</Text>
					</Group>
					<Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
						<Badge size="sm" variant="light" color="blue">
							相关 {relevant}
						</Badge>
						<Badge size="sm" variant="light" color="teal">
							已处理 {addressed}
						</Badge>
						{open ? (
							<IconChevronDown size={14} aria-hidden="true" />
						) : (
							<IconChevronRight size={14} aria-hidden="true" />
						)}
					</Group>
				</Group>
			</UnstyledButton>
			{open && (
				<Stack gap={6} px="xs" pb="xs">
					{states.length === 0 ? (
						<Text size="xs" c="dimmed">
							（这个时间单位没有关注点投影）
						</Text>
					) : (
						states.map((state) => <FocusStateRow key={state.id} state={state} />)
					)}
				</Stack>
			)}
		</Paper>
	);
}

/** 学生输入原文（请求回声）：kind / target / affordance_id / selection / text。 */
function InputEcho({ input }: { input: TurnInputEcho }) {
	const selection = input.selection ?? [];
	return (
		<Stack gap={4}>
			<Group gap="xs" wrap="wrap">
				{/* 未知取值原样显示（后端加词表时界面不该静默吞掉） */}
				<Badge size="sm" variant="light" color="gray">
					{INPUT_KIND[input.kind] ?? input.kind}
				</Badge>
				{input.target != null && (
					<Text size="xs" c="dimmed">
						目标：<Code>{`${input.target.kind}:${input.target.id}`}</Code>
					</Text>
				)}
				{input.affordance_id != null && (
					<Text size="xs" c="dimmed">
						声明动作：<Code>{input.affordance_id}</Code>
					</Text>
				)}
			</Group>
			{selection.length > 0 && (
				<Text size="xs" c="dimmed">
					选项：{selection.join("、")}
				</Text>
			)}
			<Code block>{input.text === "" ? "（没有自由文本）" : input.text}</Code>
		</Stack>
	);
}

/** 结算阶段：动作 / 结果 / 效果旧新值 / 揭示 / 反应 / 人物状态。 */
function ResolvedView({ resolved }: { resolved: ResolvedTurn }) {
	const meta = outcomeMeta(resolved.outcome);
	const effects = resolved.effects ?? [];
	const reveals = resolved.reveals ?? [];
	const reactions = resolved.reactions ?? [];
	const social = resolved.social ?? [];
	return (
		<Stack gap={4}>
			<Group gap="xs" wrap="wrap" align="baseline">
				<Text size="xs" c="dimmed">
					动作：
				</Text>
				<Text size="xs">
					{resolved.action.label || resolved.action.text || "（没有标签）"}
				</Text>
				<Badge size="sm" variant="light" color={meta.color}>
					{meta.label}
				</Badge>
			</Group>
			{resolved.block_reason !== "" && (
				<Text size="xs" c="orange.7">
					受阻原因：{resolved.block_reason}
				</Text>
			)}
			<Text size="xs" c="dimmed">
				效果（旧 → 新）
			</Text>
			{effects.length === 0 ? (
				<Text size="xs" c="dimmed">
					（这一次请求没有状态改动）
				</Text>
			) : (
				<Stack gap={2}>
					{effects.map((effect, index) => (
						<Text key={`${index}-${effect.key}`} size="xs">
							<Code>{effect.source || "world"}</Code> {effectText(effect)}
						</Text>
					))}
				</Stack>
			)}
			<Text size="xs" c="dimmed">
				揭示：{reveals.length === 0 ? "无" : reveals.join("、")}
			</Text>
			<Text size="xs" c="dimmed">
				反应：{reactions.length === 0 ? "无" : reactions.join("、")}
			</Text>
			{social.length > 0 && (
				<Text size="xs" c="dimmed">
					人物状态：{social.map(effectText).join("；")}
				</Text>
			)}
		</Stack>
	);
}

/** 交付阶段：台词（谁说的 + 来源）+ 提示 / 图片 / 高亮。 */
function DeliveryView({ delivery }: { delivery: SceneDelivery }) {
	const messages = delivery.messages ?? [];
	const hints = delivery.hints ?? [];
	const assets = delivery.assets ?? [];
	const highlights = delivery.highlights ?? [];
	return (
		<Stack gap={6}>
			{messages.length === 0 ? (
				<Text size="xs" c="dimmed">
					（这一次请求没有交付台词）
				</Text>
			) : (
				messages.map((message, index) => (
					<DeliveryLine key={`${index}-${message.text.slice(0, 12)}`} message={message} />
				))
			)}
			<Group gap="xs" wrap="wrap">
				{hints.length > 0 && (
					<Text size="xs" c="dimmed">
						提示：{hints.join("、")}
					</Text>
				)}
				{assets.length > 0 && (
					<Text size="xs" c="dimmed">
						图片：{assets.join("、")}
					</Text>
				)}
				{highlights.length > 0 && (
					<Text size="xs" c="dimmed">
						高亮：{highlights.join("、")}
					</Text>
				)}
			</Group>
		</Stack>
	);
}

function DeliveryLine({ message }: { message: DeliveryMessage }) {
	const sources = message.sources ?? [];
	const speaker = message.speaker || message.as_role || "（未标注说话人）";
	return (
		<Box>
			<Group gap={6} wrap="wrap">
				<Text size="xs" fw={500}>
					{speaker}
				</Text>
				{message.ephemeral && (
					<Badge size="xs" variant="light" color="gray">
						临时
					</Badge>
				)}
			</Group>
			<Text size="xs">{message.text}</Text>
			{sources.length > 0 && (
				<Text size="xs" c="dimmed">
					来源：{sources.join("、")}
				</Text>
			)}
		</Box>
	);
}

/** 请求结果：世界答复 / 受阻原因 / 阶段问题 / 模型调用计数。 */
function TurnResult({
	replay,
	models,
}: {
	replay: ScenarioAdminTurnReplay;
	models: ModelsUsed | null;
}) {
	const meta = outcomeMeta(replay.outcome);
	const problems = replay.problems ?? [];
	return (
		<Stack gap={4}>
			<Group gap="xs" wrap="wrap" align="baseline">
				<Badge size="sm" variant="light" color={meta.color}>
					{meta.label}
				</Badge>
				{replay.block_reason != null && replay.block_reason !== "" && (
					<Text size="xs" c="orange.7">
						受阻原因：{replay.block_reason}
					</Text>
				)}
			</Group>
			{problems.length === 0 ? (
				<Text size="xs" c="dimmed">
					问题：无
				</Text>
			) : (
				<Stack gap={4}>
					<Text size="xs" c="dimmed">
						问题（{problems.length}）
					</Text>
					{problems.map((problem, index) => (
						<Code key={`${index}-${problem}`} block>
							{problem}
						</Code>
					))}
				</Stack>
			)}
			<Text size="xs" c="dimmed">
				模型调用：
				{models === null
					? "未记录"
					: `解析 ${models.parse} 次 · 交付 ${models.delivery} 次`}
			</Text>
		</Stack>
	);
}

/** 一条已提交请求：标题行（时间单位 / seq / request_id / 类型 / 结果）+ 展开后的四个阶段。 */
function TurnReplayBlock({ replay }: { replay: ScenarioAdminTurnReplay }) {
	const [open, setOpen] = useState(false);
	const meta = outcomeMeta(replay.outcome);
	const resolved = replay.resolved ?? null;
	const delivery = replay.delivery ?? null;
	const models = replay.models ?? null;
	return (
		<Paper withBorder radius="sm">
			<UnstyledButton
				w="100%"
				p="xs"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-label={`${turnLabel(replay.turn)} 的解析 / 结算 / 交付回放`}
			>
				<Group justify="space-between" wrap="nowrap" gap="xs">
					<Box miw={0}>
						<Group gap={6} wrap="wrap">
							<Text size="sm" fw={600}>
								{turnLabel(replay.turn)}
							</Text>
							<Badge size="sm" variant="light" color={meta.color}>
								{meta.label}
							</Badge>
							{replay.kind !== "" && (
								<Text size="xs" c="dimmed">
									输入类型 {replay.kind}
								</Text>
							)}
						</Group>
						<Text size="xs" c="dimmed" truncate title={replay.request_id}>
							seq {replay.seq} · request_id {replay.request_id === "" ? "—" : replay.request_id}
						</Text>
					</Box>
					{open ? (
						<IconChevronDown size={14} aria-hidden="true" />
					) : (
						<IconChevronRight size={14} aria-hidden="true" />
					)}
				</Group>
			</UnstyledButton>
			{open && (
				<Stack gap="sm" px="xs" pb="xs">
					<Stage label="输入" note="学生请求原文（kind / 目标 / 声明动作 / 选项 / 自由文本）">
						<InputEcho input={replay.input} />
					</Stage>
					<Stage label="解析结果" note="模型解析产物，不是思考过程">
						{replay.intent == null ? (
							<Text size="xs" c="dimmed">
								（这一次请求没有解析记录）
							</Text>
						) : (
							<Code block>{JSON.stringify(replay.intent, null, 2)}</Code>
						)}
					</Stage>
					<Stage label="结算" note="世界这一次确定性地发生了什么">
						{resolved === null ? (
							<Text size="xs" c="dimmed">
								（这一次请求没有结算记录：没有推进世界——澄清与求提示只读）
							</Text>
						) : (
							<ResolvedView resolved={resolved} />
						)}
					</Stage>
					<Stage label="交付" note="演出的最终产出（学生看到的话）">
						{delivery === null ? (
							<Text size="xs" c="dimmed">
								（这一次请求没有交付记录）
							</Text>
						) : (
							<DeliveryView delivery={delivery} />
						)}
					</Stage>
					<Stage label="请求结果">
						<TurnResult replay={replay} models={models} />
					</Stage>
				</Stack>
			)}
		</Paper>
	);
}

export default function AdminFocusPanel({
	focus = null,
	turns = null,
}: {
	/** 教学关注点的时间单位投影（`detail.focus`）。 */
	focus?: ScenarioAdminFocusTurn[] | null;
	/** 已提交请求的「解析 → 结算 → 交付」回放（`detail.turns`）。 */
	turns?: ScenarioAdminTurnReplay[] | null;
}) {
	const focusTurns = focus ?? [];
	const replayTurns = turns ?? [];
	return (
		<Stack gap="md">
			<Box component="section" aria-label="教学关注点投影">
				<Group justify="space-between" align="baseline" mb={4} gap="xs" wrap="wrap">
					<Text size="sm" fw={600}>
						教学关注点投影（按时间单位）
					</Text>
					<Text size="xs" c="dimmed">
						每个时间单位边界重算 · 只在管理侧可见
					</Text>
				</Group>
				<Text size="xs" c="dimmed" mb={6}>
					「已处理」= 本包声明的观察条件（addressed_when）在这个时间单位成立，也就是本包看到了处理证据；
					它不等于学生能力达标。关注点没有推进权，也不解锁世界。
				</Text>
				{focusTurns.length === 0 ? (
					<Text size="sm" c="dimmed">
						本包未声明教学关注点
					</Text>
				) : (
					<Stack gap={6}>
						{focusTurns.map((item) => (
							<FocusTurnRow
								key={item.turn}
								turn={item.turn}
								states={item.states ?? []}
							/>
						))}
					</Stack>
				)}
			</Box>

			<Box component="section" aria-label="逐请求来源回放">
				<Group justify="space-between" align="baseline" mb={4} gap="xs" wrap="wrap">
					<Text size="sm" fw={600}>
						请求来源回放（解析 → 结算 → 交付）
					</Text>
					<Text size="xs" c="dimmed">
						记录下来的阶段产物 · 不是模型的思考过程
					</Text>
				</Group>
				{replayTurns.length === 0 ? (
					<Text size="sm" c="dimmed">
						还没有已提交请求
					</Text>
				) : (
					<Stack gap={6}>
						{replayTurns.map((item) => (
							<TurnReplayBlock key={item.seq} replay={item} />
						))}
					</Stack>
				)}
			</Box>
		</Stack>
	);
}
