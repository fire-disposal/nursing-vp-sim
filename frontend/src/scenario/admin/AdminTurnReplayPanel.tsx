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
import type { ScenarioAdminTurnReplay } from "@/api/scenario";

/**
 * 回放的一块**过程证据**：每一条已提交请求一次一条的「输入 → 结算 → 工具 → 交付」。
 *
 * 展示的全部是**记录下来的产物**（学生输入原文、确定性结算差量、每一次工具调用、模型写给
 * 自己的备忘、最终交付的话），不是模型的自述思考过程——标签一律用「结算 / 工具账 / 交付」，
 * 不许写成"思考"。`tools` 里的**被拒**调用与原因照样摆出来：那是"模型想干什么、平台为什么不许"
 * 的唯一证据；`notes` 是模型草稿纸，**只教师可见**，学生接口里没有。
 */

/** 回放里各段产物与调用计数：从回放类型派生，不给 `api/scenario.ts` 再加手工别名。 */
type TurnInputEcho = ScenarioAdminTurnReplay["input"];
type ResolvedTurn = NonNullable<ScenarioAdminTurnReplay["resolved"]>;
type SceneDelivery = NonNullable<ScenarioAdminTurnReplay["delivery"]>;
type ModelsUsed = NonNullable<ScenarioAdminTurnReplay["models"]>;
type AppliedEffect = NonNullable<ResolvedTurn["effects"]>[number];
type DeliveryMessage = NonNullable<SceneDelivery["messages"]>[number];
type ToolCall = NonNullable<ScenarioAdminTurnReplay["tools"]>[number];

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

/** 结算阶段：动作 / 结果 / 效果旧新值 / 揭示 / 观察到的事实。 */
function ResolvedView({ resolved }: { resolved: ResolvedTurn }) {
	const meta = outcomeMeta(resolved.outcome);
	const effects = resolved.effects ?? [];
	const reveals = resolved.reveals ?? [];
	const facts = resolved.facts ?? [];
	const action = resolved.action;
	return (
		<Stack gap={4}>
			<Group gap="xs" wrap="wrap" align="baseline">
				<Text size="xs" c="dimmed">
					动作：
				</Text>
				<Text size="xs">
					{action === undefined
						? "（没有行动回声）"
						: action.label || action.text || "（没有标签）"}
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
				观察到的事实：{facts.length === 0 ? "无" : facts.join("、")}
			</Text>
		</Stack>
	);
}

/** 一笔工具调用：工具名 + 通过 / 被拒（被拒必须给原因）+ 细节参数。 */
function ToolRow({ call }: { call: ToolCall }) {
	const args = call.args ?? {};
	const hasArgs = Object.keys(args).length > 0;
	return (
		<Box>
			<Group gap={6} wrap="wrap" align="baseline">
				<Badge size="sm" variant="light" color={call.ok ? "teal" : "orange"}>
					{call.ok ? "通过" : "被拒"}
				</Badge>
				<Code>{call.tool}</Code>
				{!call.ok && call.reason !== "" && (
					<Text size="xs" c="orange.7">
						原因：{call.reason}
					</Text>
				)}
			</Group>
			{call.detail !== "" && (
				<Text size="xs" c="dimmed">
					{call.detail}
				</Text>
			)}
			{hasArgs && <Code block>{JSON.stringify(args, null, 2)}</Code>}
		</Box>
	);
}

/** 工具账：模型每一次工具调用（含被拒的那些与原因），外加按原因汇总的拒绝计数。 */
function ToolsView({ replay }: { replay: ScenarioAdminTurnReplay }) {
	const tools = replay.tools ?? [];
	const rejections = Object.entries(replay.tool_rejections ?? {});
	if (tools.length === 0 && rejections.length === 0) {
		return (
			<Text size="xs" c="dimmed">
				（这一次请求没有工具调用）
			</Text>
		);
	}
	return (
		<Stack gap={6}>
			{tools.map((call, index) => (
				<ToolRow key={`${index}-${call.tool}`} call={call} />
			))}
			{rejections.length > 0 && (
				<Text size="xs" c="dimmed">
					被拒汇总：
					{rejections.map(([reason, count]) => `${reason} ×${count}`).join("、")}
				</Text>
			)}
		</Stack>
	);
}

/** 模型草稿纸：写给自己的备忘，只教师可见（学生接口里没有这一项）。 */
function NotesView({ notes }: { notes: string[] }) {
	if (notes.length === 0) {
		return (
			<Text size="xs" c="dimmed">
				（这一次请求没有留下草稿）
			</Text>
		);
	}
	return (
		<Stack gap={4}>
			{notes.map((note, index) => (
				<Code key={`${index}-${note.slice(0, 12)}`} block>
					{note}
				</Code>
			))}
		</Stack>
	);
}

/** 交付阶段：这一次请求的最终交付（学生看到的话）。 */
function DeliveryView({ delivery }: { delivery: SceneDelivery }) {
	const messages = delivery.messages ?? [];
	if (messages.length === 0) {
		return (
			<Text size="xs" c="dimmed">
				（这一次请求没有交付台词）
			</Text>
		);
	}
	return (
		<Stack gap={6}>
			{messages.map((message, index) => (
				<DeliveryLine key={`${index}-${message.text.slice(0, 12)}`} message={message} />
			))}
		</Stack>
	);
}

function DeliveryLine({ message }: { message: DeliveryMessage }) {
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
				模型调用：{models === null ? "未记录" : `${models.calls} 次`}
			</Text>
		</Stack>
	);
}

/** 一条已提交请求：标题行（时间单位 / seq / request_id / 结果）+ 展开后的各段。 */
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
				aria-label={`${turnLabel(replay.turn)} 的请求回放`}
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
					<Stage label="输入" note="学生请求原文（类型 / 目标 / 声明动作 / 选项 / 自由文本）">
						<InputEcho input={replay.input} />
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
					<Stage label="工具账" note="模型每一次工具调用（被拒的也在这里，含原因）">
						<ToolsView replay={replay} />
					</Stage>
					<Stage label="草稿纸" note="模型写给自己的备忘 · 只教师可见">
						<NotesView notes={replay.notes ?? []} />
					</Stage>
					<Stage label="交付" note="这一次请求的最终交付（学生看到的话）">
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

export default function AdminTurnReplayPanel({
	turns = null,
}: {
	/** 已提交请求的「输入 → 结算 → 工具 → 交付」回放（`detail.turns`）。 */
	turns?: ScenarioAdminTurnReplay[] | null;
}) {
	const replayTurns = turns ?? [];
	return (
		<Box component="section" aria-label="逐请求回放">
			<Group justify="space-between" align="baseline" mb={4} gap="xs" wrap="wrap">
				<Text size="sm" fw={600}>
					逐请求回放（输入 → 结算 → 工具 → 交付）
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
	);
}
