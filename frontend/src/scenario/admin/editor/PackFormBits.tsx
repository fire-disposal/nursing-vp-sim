/**
 * 表单原语：列表编辑器（增删排序）、带定位的分节卡片、以及几个被多节共用的复合编辑器
 * （触发条件 / 效果 / 目标引用 / 标量值 / 字符串行 / 自由映射）。
 *
 * 与 `PackForm` 分开只为让"每个列表都能增删排序"这句话只实现一次：每一节里的列表共用同一套
 * 上下移/删除/添加；同一事实（例如"效果里的状态键只能从登记过的键里选"）也只在这里实现一次。
 *
 * 复合编辑器一律按**路径**读写（`doc` + `path` + `onChange`），所以同一节里多处用同一段代码，
 * 不必为每个字段各写一份读写。
 */

import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	Code,
	Group,
	NumberInput,
	Paper,
	Select,
	Stack,
	Switch,
	Text,
	TextInput,
} from "@mantine/core";
import { IconAlertTriangle, IconArrowDown, IconArrowUp, IconPlus, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ScenarioPackDoc, ScenarioPackProblem, ScenarioPackValue } from "@/api/scenario";
import { listAt, moveIn, nodeAt, removeAt, setIn, tableAt, textAt } from "./packDoc";

type Key = string | number;
type Change = (next: ScenarioPackDoc) => void;

/** 引用别处的 id 时用的候选表（**全部从已有 id 里选**，不接受手敲）。 */
export interface RefOptions {
	actors: string[];
	devices: string[];
	affordances: string[];
	cues: string[];
	facts: string[];
	stateKeys: string[];
}

/** 一个可增删排序的列表：每一项由调用方渲染，工具条在这一层统一。 */
export function ListEditor<T>({
	items,
	onChange,
	render,
	create,
	addLabel,
	emptyText,
}: {
	items: T[];
	onChange: (next: T[]) => void;
	render: (item: T, index: number) => ReactNode;
	/** 新项的初值（作者点了「添加」之后能直接改，不弹对话框）。 */
	create: () => T;
	addLabel: string;
	emptyText: string;
}) {
	return (
		<Stack gap="sm">
			{items.length === 0 && (
				<Text size="xs" c="dimmed">
					{emptyText}
				</Text>
			)}
			{items.map((item, index) => (
				<Paper key={index} withBorder p="xs">
					<Group gap="xs" align="flex-start" wrap="nowrap">
						<Stack gap="xs" style={{ flex: 1 }}>
							{render(item, index)}
						</Stack>
						<Stack gap={4}>
							<ActionIcon
								variant="subtle"
								size="sm"
								aria-label="上移"
								disabled={index === 0}
								onClick={() => onChange(moveIn(items, index, index - 1))}
							>
								<IconArrowUp size={14} />
							</ActionIcon>
							<ActionIcon
								variant="subtle"
								size="sm"
								aria-label="下移"
								disabled={index === items.length - 1}
								onClick={() => onChange(moveIn(items, index, index + 1))}
							>
								<IconArrowDown size={14} />
							</ActionIcon>
							<ActionIcon
								variant="subtle"
								color="red"
								size="sm"
								aria-label="删除"
								onClick={() => onChange(removeAt(items, index))}
							>
								<IconX size={14} />
							</ActionIcon>
						</Stack>
					</Group>
				</Paper>
			))}
			<Group>
				<Button
					variant="light"
					size="compact-sm"
					leftSection={<IconPlus size={14} />}
					onClick={() => onChange([...items, create()])}
				>
					{addLabel}
				</Button>
			</Group>
		</Stack>
	);
}

/** 一节的标题 + 该节自己的校验问题（问题来自后端，不在这里重算）。 */
export function Section({
	id,
	title,
	hint,
	issues,
	children,
}: {
	id: string;
	title: string;
	hint?: string;
	issues: ScenarioPackProblem[];
	children: ReactNode;
}) {
	return (
		<Paper withBorder p="md" id={`pack-section-${id}`}>
			<Group gap="xs" mb={4} wrap="wrap">
				<Text fw={600}>{title}</Text>
				{issues.length > 0 && (
					<Badge color="red" variant="light">
						{issues.length} 处问题
					</Badge>
				)}
			</Group>
			{hint !== undefined && (
				<Text size="xs" c="dimmed" mb="sm">
					{hint}
				</Text>
			)}
			{issues.length > 0 && (
				<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} mb="sm">
					<Stack gap={2}>
						{issues.map((issue) => (
							<Text size="xs" key={`${issue.path}:${issue.message}`}>
								{issue.path !== "" && <Code>{issue.path}</Code>} {issue.message}
							</Text>
						))}
					</Stack>
				</Alert>
			)}
			{children}
		</Paper>
	);
}

/** 一串字符串（资源、表单字段、禁用词……）：只有文本行，其余与 `ListEditor` 同形。 */
export function StringListRow({
	label,
	items,
	onChange,
	addLabel,
	emptyText,
	placeholder,
}: {
	label: string;
	items: string[];
	onChange: (next: string[]) => void;
	addLabel: string;
	emptyText: string;
	placeholder?: string;
}) {
	return (
		<div>
			<Text size="xs" c="dimmed" mb={4}>
				{label}
			</Text>
			<ListEditor
				items={items}
				onChange={onChange}
				create={() => ""}
				addLabel={addLabel}
				emptyText={emptyText}
				render={(item, index) => (
					<TextInput
						value={item}
						placeholder={placeholder}
						onChange={(event) =>
							onChange(items.map((value, position) => (position === index ? event.currentTarget.value : value)))
						}
					/>
				)}
			/>
		</div>
	);
}

/**
 * 一个**自由的标量值**（状态键初值 / 效果值 / 条件值 / 人物的"知道什么"）。
 *
 * 类型由作者选（文字 / 数字 / 布尔），界面不猜：同一格在不同场景下要的就是不同类型，
 * 猜错会把 `"3"` 存成 `3`，运行时行为悄悄变掉。切换类型给出该类型的空值。
 */
export function ScalarValueInput({
	value,
	onChange,
	label,
}: {
	value: ScenarioPackValue | undefined;
	onChange: (next: ScenarioPackValue) => void;
	label?: string;
}) {
	const kind = typeof value === "boolean" ? "bool" : typeof value === "number" ? "num" : "str";
	const rows: { value: string; label: string }[] = [
		{ value: "str", label: "文字" },
		{ value: "num", label: "数字" },
		{ value: "bool", label: "布尔" },
	];
	return (
		<Group align="flex-end" gap="xs" wrap="nowrap">
			<Select
				label={label}
				data={rows}
				allowDeselect={false}
				value={kind}
				onChange={(next) =>
					onChange(next === "bool" ? true : next === "num" ? 0 : typeof value === "string" ? value : "")
				}
				w={90}
			/>
			{kind === "bool" ? (
				<Switch
					mt="xl"
					label={value === true ? "真" : "假"}
					checked={value === true}
					onChange={(event) => onChange(event.currentTarget.checked)}
				/>
			) : kind === "num" ? (
				<NumberInput
					value={typeof value === "number" ? value : 0}
					onChange={(next) => onChange(typeof next === "number" ? next : 0)}
					w={140}
				/>
			) : (
				<TextInput
					value={typeof value === "string" ? value : ""}
					onChange={(event) => onChange(event.currentTarget.value)}
					w={260}
				/>
			)}
		</Group>
	);
}

const CLAUSE_KINDS = [
	{ value: "action_used", label: "用过某个动作" },
	{ value: "cue_revealed", label: "某条线索已揭示" },
	{ value: "state_cmp", label: "状态键比较" },
	{ value: "fact_declared", label: "某个事实已采集到" },
];

const COMPARE_OPS = ["<", "<=", "==", ">=", ">"].map((op) => ({ value: op, label: op }));

/** 一个条件子句（kind 决定后面填哪几个字段；换 kind 时把无关字段清掉，不留幽灵引用）。 */
function ClauseRow({
	clause,
	onChange,
	refs,
}: {
	clause: Record<string, ScenarioPackValue>;
	onChange: (next: ScenarioPackValue) => void;
	refs: RefOptions;
}) {
	const kind = typeof clause.kind === "string" ? clause.kind : "action_used";
	const set = (patch: Record<string, ScenarioPackValue>) => onChange({ ...clause, ...patch });
	return (
		<Group align="flex-end" gap="xs" wrap="wrap">
			<Select
				label="条件"
				data={CLAUSE_KINDS}
				allowDeselect={false}
				value={kind}
				onChange={(next) => next && onChange({ kind: next })}
				w={170}
			/>
			{kind === "action_used" && (
				<Select
					label="动作"
					data={refs.affordances}
					searchable
					value={typeof clause.affordance_id === "string" ? clause.affordance_id : null}
					onChange={(next) => set({ affordance_id: next })}
					w={200}
				/>
			)}
			{kind === "cue_revealed" && (
				<Select
					label="线索"
					data={refs.cues}
					searchable
					value={typeof clause.cue_id === "string" ? clause.cue_id : null}
					onChange={(next) => set({ cue_id: next })}
					w={200}
				/>
			)}
			{kind === "fact_declared" && (
				<Select
					label="事实"
					data={refs.facts}
					searchable
					value={typeof clause.fact_id === "string" ? clause.fact_id : null}
					onChange={(next) => set({ fact_id: next })}
					w={200}
				/>
			)}
			{kind === "state_cmp" && (
				<>
					<Select
						label="状态键"
						data={refs.stateKeys}
						searchable
						value={typeof clause.key === "string" ? clause.key : null}
						onChange={(next) => set({ key: next })}
						w={200}
					/>
					<Select
						label="比较"
						data={COMPARE_OPS}
						allowDeselect={false}
						value={typeof clause.op === "string" ? clause.op : "=="}
						onChange={(next) => set({ op: next })}
						w={90}
					/>
					<ScalarValueInput label="值" value={clause.value} onChange={(next) => set({ value: next })} />
				</>
			)}
		</Group>
	);
}

/**
 * 一个**门控条件**（全部子句 AND）：`visible_when`（动作/设备/通道按需出现）与 `failure_when`。
 *
 * 「没有条件」写成整个字段为空（后端也这么解释：省略 = 一直成立）；显式写出空条件是加载期
 * 会拒的形状，所以这里用开关表达"有没有条件"，不让界面产出空条件。
 */
export function TriggerEditor({
	title,
	hint,
	switchLabel = "按条件出现",
	doc,
	path,
	onChange,
	refs,
}: {
	title: string;
	hint?: string;
	switchLabel?: string;
	doc: ScenarioPackDoc;
	path: Key[];
	onChange: Change;
	refs: RefOptions;
}) {
	const clauses = listAt<Record<string, ScenarioPackValue>>(doc, ...path, "all");
	const write = (next: Record<string, ScenarioPackValue>[]) =>
		onChange(setIn(doc, path, next.length === 0 ? null : { all: next }));
	const create = (): Record<string, ScenarioPackValue> => ({ kind: "action_used", affordance_id: refs.affordances[0] ?? "" });

	return (
		<Stack gap="xs">
			<Group justify="space-between" align="flex-end" wrap="wrap">
				<div>
					<Text size="sm" fw={500}>
						{title}
					</Text>
					{hint !== undefined && (
						<Text size="xs" c="dimmed">
							{hint}
						</Text>
					)}
				</div>
				<Switch
					label={switchLabel}
					checked={clauses.length > 0}
					onChange={(event) => write(event.currentTarget.checked ? [create()] : [])}
				/>
			</Group>
			{clauses.length > 0 && (
				<ListEditor
					items={clauses}
					onChange={write}
					create={create}
					addLabel="添加条件"
					emptyText="还没有条件。"
					render={(clause, index) => (
						<ClauseRow
							clause={clause}
							refs={refs}
							onChange={(next) => onChange(setIn(doc, [...path, "all", index], next))}
						/>
					)}
				/>
			)}
		</Stack>
	);
}

const EFFECT_OPS = [
	{ value: "set", label: "set · 设为" },
	{ value: "incr", label: "incr · 加" },
	{ value: "decr", label: "decr · 减" },
];

/** 状态键的短名（`scene.spo2` → `spo2`；效果里 key 与 target 是分开写的两格）。 */
export function shortKey(stateKey: string): string {
	const dot = stateKey.indexOf(".");
	return dot === -1 ? stateKey : stateKey.slice(dot + 1);
}

/**
 * 动作对处境的**确定性影响**：`target` 决定去哪张表校验，`key` 只能是该目标下登记过的状态键。
 */
export function EffectListEditor({
	doc,
	path,
	onChange,
	refs,
}: {
	doc: ScenarioPackDoc;
	path: Key[];
	onChange: Change;
	refs: RefOptions;
}) {
	const effects = listAt<Record<string, ScenarioPackValue>>(doc, ...path);
	const targets = [...refs.actors, "scene"];
	const keysOf = (target: string) =>
		refs.stateKeys.filter((stateKey) => stateKey.startsWith(`${target}.`)).map(shortKey);

	return (
		<ListEditor
			items={effects}
			onChange={(next) => onChange(setIn(doc, path, next))}
			create={() => ({ target: targets[0] ?? "scene", key: "", op: "set", value: true })}
			addLabel="添加效果"
			emptyText="这个动作不直接改变处境（世界怎么回应由模型演绎）。"
			render={(effect, index) => {
				const target = typeof effect.target === "string" ? effect.target : (targets[0] ?? "scene");
				const op = typeof effect.op === "string" ? effect.op : "set";
				const keys = keysOf(target);
				return (
					<Group align="flex-end" gap="xs" wrap="wrap">
						<Select
							label="目标"
							data={targets}
							allowDeselect={false}
							value={target}
							onChange={(next) =>
								next && onChange(setIn(doc, [...path, index], { ...effect, target: next, key: "" }))
							}
							w={140}
						/>
						<Select
							label="状态键"
							data={keys}
							searchable
							description={keys.length === 0 ? "这个目标下还没有登记状态键" : undefined}
							value={typeof effect.key === "string" && effect.key !== "" ? effect.key : null}
							onChange={(next) =>
								next && onChange(setIn(doc, [...path, index, "key"], next))
							}
							w={180}
						/>
						<Select
							label="操作"
							data={EFFECT_OPS}
							allowDeselect={false}
							value={op}
							onChange={(next) => next && onChange(setIn(doc, [...path, index, "op"], next))}
							w={150}
						/>
						{op === "set" ? (
							<ScalarValueInput
								label="值"
								value={effect.value}
								onChange={(next) => onChange(setIn(doc, [...path, index, "value"], next))}
							/>
						) : (
							// 加减只能是数值（后端的加载期校验也这么要求），所以这里不给类型选择
							<NumberInput
								label="值"
								value={typeof effect.value === "number" ? effect.value : 0}
								onChange={(next) =>
									onChange(setIn(doc, [...path, index, "value"], typeof next === "number" ? next : 0))
								}
								w={140}
							/>
						)}
					</Group>
				);
			}}
		/>
	);
}

/** 动作的目标引用（`TargetRef`：kind + id，永远成对写；scene 只有一个固定 id）。 */
export function TargetListEditor({
	doc,
	path,
	onChange,
	refs,
}: {
	doc: ScenarioPackDoc;
	path: Key[];
	onChange: Change;
	refs: RefOptions;
}) {
	const targets = listAt<Record<string, ScenarioPackValue>>(doc, ...path);
	const kinds = [
		{ value: "actor", label: "人物" },
		{ value: "device", label: "设备" },
		{ value: "scene", label: "场景" },
	];
	const idsOf = (kind: string) =>
		kind === "actor" ? refs.actors : kind === "device" ? refs.devices : ["scene"];

	return (
		<ListEditor
			items={targets}
			onChange={(next) => onChange(setIn(doc, path, next))}
			create={() => ({ kind: "actor", id: refs.actors[0] ?? "" })}
			addLabel="添加目标"
			emptyText="不指定目标 = 这个动作不对准谁（全场级，例如自由发问）。"
			render={(target, index) => {
				const kind = typeof target.kind === "string" ? target.kind : "actor";
				return (
					<Group align="flex-end" gap="xs">
						<Select
							label="目标类型"
							data={kinds}
							allowDeselect={false}
							value={kind}
							onChange={(next) =>
								next && onChange(setIn(doc, [...path, index], { kind: next, id: idsOf(next)[0] ?? "" }))
							}
							w={140}
						/>
						<Select
							label="目标"
							data={idsOf(kind)}
							searchable
							allowDeselect={false}
							value={typeof target.id === "string" ? target.id : null}
							onChange={(next) => next && onChange(setIn(doc, [...path, index, "id"], next))}
							w={200}
						/>
					</Group>
				);
			}}
		/>
	);
}

/**
 * 一张**自由的键 → 标量**表（人物的 `knowledge`）：键由作者写（人名/事项名），值三选一。
 * 改名走"删了再加"，所以顺序按当前键序渲染，改动一次也只动一次（不可变写）。
 */
export function KeyValueEditor({
	label,
	hint,
	doc,
	path,
	onChange,
	newKeyPrefix,
}: {
	label: string;
	hint?: string;
	doc: ScenarioPackDoc;
	path: Key[];
	onChange: Change;
	newKeyPrefix: string;
}) {
	const entries = Object.entries(
		(nodeAt(doc, ...path) ?? {}) as Record<string, ScenarioPackValue>,
	);
	const write = (rows: [string, ScenarioPackValue][]) =>
		onChange(setIn(doc, path, Object.fromEntries(rows)));

	return (
		<div>
			<Text size="xs" c="dimmed" mb={4}>
				{label}
			</Text>
			{hint !== undefined && (
				<Text size="xs" c="dimmed" mb={4}>
					{hint}
				</Text>
			)}
			<ListEditor
				items={entries}
				onChange={write}
				create={(): [string, ScenarioPackValue] => [`${newKeyPrefix}${entries.length + 1}`, ""]}
				addLabel="添加一条"
				emptyText="还没有写任何一条。"
				render={(entry, index) => (
					<Group align="flex-end" gap="xs" wrap="wrap">
						<TextInput
							label="键"
							value={entry[0]}
							onChange={(event) =>
								write(entries.map((item, position) => (position === index ? [event.currentTarget.value, item[1]] : item)))
							}
							w={180}
						/>
						<ScalarValueInput
							label="值"
							value={entry[1]}
							onChange={(next) =>
								write(entries.map((item, position) => (position === index ? [item[0], next] : item)))
							}
						/>
					</Group>
				)}
			/>
		</div>
	);
}

/** 某张列表里各项的 `id`（没写 id 的项跳过）。 */
function idsAt(doc: ScenarioPackDoc, path: Key[]): string[] {
	const listed = listAt<Record<string, ScenarioPackValue>>(doc, ...path);
	return listed.map((_, index) => textAt(doc, ...path, index, "id")).filter((id) => id !== "");
}

/** 引用候选表：从当前内容里现算（作者先把 id 建出来，别处就能选到）。 */
export function refOptions(doc: ScenarioPackDoc): RefOptions {
	return {
		actors: idsAt(doc, ["actors"]),
		devices: idsAt(doc, ["presentation", "devices"]),
		affordances: idsAt(doc, ["affordances"]),
		cues: idsAt(doc, ["setting", "cues"]),
		facts: idsAt(doc, ["facts"]),
		stateKeys: Object.keys(tableAt(doc, "state_keys")),
	};
}
