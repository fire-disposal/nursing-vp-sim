/**
 * 场景编辑器的**表单页签**：病例里所有结构化字段都在这里改，按 pack 结构分节。
 *
 * 取向（AGENTS.md：少写格式、不手敲引用）：
 * - 列表字段（线索/人物/动作/事实/判据/设备/状态键）一律可增删排序；
 * - **所有引用都从已有 id 里选**：目标选人物/设备/场景，效果的状态键从登记过的键里选，
 *   揭示选线索、条件选动作/线索/事实/状态键——作者不需要记住任何 id 的拼写；
 * - 节内的校验问题来自后端（`POST .../validate`），这里只**归位**不重算——
 *   路径映射是 `sectionForPath`，节标题上的红字与顶部摘要指向同一处；
 * - 表单覆盖不到的自由结构（动作参数里的自定义键、判据的锚点得分表）保持原值不动，
 *   要改它们导出病例文件夹离线改再导入（`sectionForPath` 的「原样保留」那张卡里写着清单）。
 */

import {
	Accordion,
	ActionIcon,
	Badge,
	Button,
	Code,
	Group,
	MultiSelect,
	NumberInput,
	Select,
	Stack,
	Switch,
	Text,
	TextInput,
	Textarea,
} from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";
import type { ScenarioPackDoc, ScenarioPackProblem, ScenarioPackValue } from "@/api/scenario";
import {
	EffectListEditor,
	KeyValueEditor,
	ListEditor,
	type RefOptions,
	ScalarValueInput,
	Section,
	StringListRow,
	TargetListEditor,
	TriggerEditor,
	refOptions,
	shortKey,
} from "./PackFormBits";
import { deleteIn, listAt, nodeAt, numberAt, setIn, tableAt, textAt } from "./packDoc";
import { issuesOf } from "./sections";

const AFFORDANCE_TYPES: { value: string; label: string }[] = [
	{ value: "ask", label: "ask · 发问（自由文本）" },
	{ value: "observe", label: "observe · 查看 / 注意" },
	{ value: "measure", label: "measure · 取数值（读数卡）" },
	{ value: "act", label: "act · 施加动作" },
	{ value: "document", label: "document · 记录（表单型）" },
	{ value: "summon", label: "summon · 呼叫 / 拉人" },
];

const PRESENCES = ["on_site", "remote", "callable", "inaccessible"].map((value) => ({
	value,
	label: value,
}));

const DEMANDS = ["loud", "quiet", "neutral"].map((value) => ({ value, label: value }));

const DEVICE_KINDS = ["monitor", "phone", "pump", "other"].map((value) => ({ value, label: value }));

const JUDGE_RULES = [
	{ value: "first_action", label: "first_action · 第一个动作" },
	{ value: "avoid_repeat", label: "avoid_repeat · 没有重复无效动作" },
	{ value: "require_within", label: "require_within · 时间窗口内做到" },
	{ value: "action_set_covers", label: "action_set_covers · 动作覆盖度" },
	{ value: "action_order", label: "action_order · 动作先后顺序" },
	{ value: "option_choice", label: "option_choice · 选了哪一项" },
];

/** action_order 的第二个参数名（后端 `_RULE_AFFORDANCE_KEYS` 里的固定键：先做 / 后做）。 */
const ORDER_AFTER = "then";

/** 判据规则各自的参数形状（换规则时按新的形状重置，不留上一条规则的残留键）。 */
function defaultParams(rule: string): Record<string, ScenarioPackValue> {
	if (rule === "first_action") return { affordances: [], belongs: true };
	if (rule === "avoid_repeat") return { affordance_id: "", max: 1 };
	if (rule === "require_within") return { affordances: [], within_turns: 0 };
	if (rule === "action_order") return { first: [], [ORDER_AFTER]: [] };
	if (rule === "option_choice") return { affordances: [], correct: [], acceptable: [] };
	return { affordances: [], min: 1 };
}

/** 表单覆盖不到、按原值保存的顶层字段（要改它们就导出文件夹离线改）。 */
const UNCOVERED: string[] = ["criterion.score_map", "affordance.params 里自定义的键", "actor.knowledge 之外的自定义字段"];

type Change = (next: ScenarioPackDoc) => void;

interface SectionProps {
	doc: ScenarioPackDoc;
	onChange: Change;
	issues: ScenarioPackProblem[];
	refs: RefOptions;
}

export default function PackForm({
	doc,
	onChange,
	problems,
}: {
	doc: ScenarioPackDoc;
	onChange: Change;
	problems: ScenarioPackProblem[];
}) {
	const refs = refOptions(doc);
	const props = { doc, onChange, issues: problems, refs };
	return (
		<Stack gap="md">
			<BasicSection {...props} />
			<SettingSection {...props} />
			<CuesSection {...props} />
			<ActorsSection {...props} />
			<StateSection {...props} />
			<AffordancesSection {...props} />
			<FactsSection {...props} />
			<RubricSection {...props} />
			<DevicesSection {...props} />
			<FailureSection {...props} />
			<Accordion variant="separated">
				<Accordion.Item value="uncovered">
					<Accordion.Control>
						<Group gap="xs">
							<Text size="sm">表单覆盖不到、按原值保存的字段</Text>
							<Badge variant="light" color="gray">
								{UNCOVERED.length} 处
							</Badge>
						</Group>
					</Accordion.Control>
					<Accordion.Panel>
						<Text size="xs" c="dimmed" mb={4}>
							这些结构本表单不改、保存时原样带走。要改它们，用这一行的「导出」下载病例文件夹
							（`case.toml` / `case.md`），离线改好再从「导入」传回来。
						</Text>
						<Stack gap={2}>
							{UNCOVERED.map((item) => (
								<Text size="xs" key={item}>
									<Code>{item}</Code>
								</Text>
							))}
						</Stack>
					</Accordion.Panel>
				</Accordion.Item>
			</Accordion>
		</Stack>
	);
}

function BasicSection({ doc, onChange, issues }: SectionProps) {
	return (
		<Section
			id="basic"
			title="基本信息"
			hint="标题与一句话出现在学生入口页；key 是病例身份，在列表里改（这里只读）。"
			issues={issuesOf(issues, "basic")}
		>
			<Stack gap="sm">
				<TextInput
					label="标题"
					value={textAt(doc, "title")}
					onChange={(event) => onChange(setIn(doc, ["title"], event.currentTarget.value))}
				/>
				<Textarea
					label="一句话"
					description="学生选情境时读到的那一句"
					autosize
					minRows={2}
					value={textAt(doc, "one_line")}
					onChange={(event) => onChange(setIn(doc, ["one_line"], event.currentTarget.value))}
				/>
				<TextInput
					label="玩家角色"
					description="学生在这件事里是谁（如「夜班护士」）"
					value={textAt(doc, "player", "role")}
					onChange={(event) => onChange(setIn(doc, ["player", "role"], event.currentTarget.value))}
				/>
				<Group gap="xs">
					<Text size="xs" c="dimmed">
						病例 key
					</Text>
					<Code>{textAt(doc, "key")}</Code>
					<Text size="xs" c="dimmed">
						（只读）
					</Text>
				</Group>
			</Stack>
		</Section>
	);
}

function SettingSection({ doc, onChange, issues }: SectionProps) {
	return (
		<Section
			id="setting"
			title="场景"
			hint="地点、时间线索与手边可用的东西。"
			issues={issuesOf(issues, "setting")}
		>
			<Stack gap="sm">
				<TextInput
					label="地点"
					value={textAt(doc, "setting", "place")}
					onChange={(event) => onChange(setIn(doc, ["setting", "place"], event.currentTarget.value))}
				/>
				<TextInput
					label="时间线索"
					description="如「凌晨 02:10」——只是世界的一句交代，不是时钟"
					value={textAt(doc, "setting", "time_hint")}
					onChange={(event) => onChange(setIn(doc, ["setting", "time_hint"], event.currentTarget.value))}
				/>
				<StringListRow
					label="手边有什么"
					items={listAt<string>(doc, "setting", "resources")}
					onChange={(value) => onChange(setIn(doc, ["setting", "resources"], value))}
					addLabel="添加资源"
					emptyText="还没有声明手边有什么。"
					placeholder="如「床旁吸引器」"
				/>
			</Stack>
		</Section>
	);
}

function CuesSection({ doc, onChange, issues }: SectionProps) {
	const cues = listAt<ScenarioPackValue>(doc, "setting", "cues");
	return (
		<Section
			id="cues"
			title="线索"
			hint="世界给人看的东西。开场就可见的打勾；其余的等动作的「揭示」把它们放出来。"
			issues={issuesOf(issues, "cues")}
		>
			<ListEditor
				items={cues}
				onChange={(value) => onChange(setIn(doc, ["setting", "cues"], value))}
				create={() => ({ id: "c_new", text: "", visible_from_start: false })}
				addLabel="添加线索"
				emptyText="还没有声明线索。"
				render={(_cue, index) => (
					<>
						<Group grow align="flex-start">
							<TextInput
								label="id"
								value={textAt(doc, "setting", "cues", index, "id")}
								onChange={(event) =>
									onChange(setIn(doc, ["setting", "cues", index, "id"], event.currentTarget.value))
								}
							/>
							<Switch
								label="开场就可见"
								mt="xl"
								checked={listAt<ScenarioPackValue>(doc, "setting", "cues")[index] !== undefined &&
									nodeAt(doc, "setting", "cues", index, "visible_from_start") === true}
								onChange={(event) =>
									onChange(
										setIn(
											doc,
											["setting", "cues", index, "visible_from_start"],
											event.currentTarget.checked,
										),
									)
								}
							/>
						</Group>
						<Textarea
							label="线索文本"
							description="学生看到的那句话；不得泄露未揭示的真相"
							autosize
							minRows={2}
							value={textAt(doc, "setting", "cues", index, "text")}
							onChange={(event) =>
								onChange(setIn(doc, ["setting", "cues", index, "text"], event.currentTarget.value))
							}
						/>
					</>
				)}
			/>
		</Section>
	);
}

function ActorsSection({ doc, onChange, issues }: SectionProps) {
	return (
		<Section
			id="actors"
			title="在场者"
			hint="接触方式（presence）决定学生能不能搭上话；他是怎样的人写在「散文」页签的「人物」里。"
			issues={issuesOf(issues, "actors")}
		>
			<ListEditor
				items={listAt<ScenarioPackValue>(doc, "actors")}
				onChange={(value) => onChange(setIn(doc, ["actors"], value))}
				create={() => ({ id: "actor_new", role: "", presence: "on_site", demand: "neutral", knowledge: {} })}
				addLabel="添加在场者"
				emptyText="还没有声明任何在场者。"
				render={(_actor, index) => (
					<>
						<Group grow align="flex-start">
							<TextInput
								label="id"
								value={textAt(doc, "actors", index, "id")}
								onChange={(event) => onChange(setIn(doc, ["actors", index, "id"], event.currentTarget.value))}
							/>
							<TextInput
								label="身份"
								value={textAt(doc, "actors", index, "role")}
								onChange={(event) => onChange(setIn(doc, ["actors", index, "role"], event.currentTarget.value))}
							/>
						</Group>
						<Group grow align="flex-start">
							<Select
								label="接触方式"
								data={PRESENCES}
								allowDeselect={false}
								value={textAt(doc, "actors", index, "presence") || "on_site"}
								onChange={(value) => value && onChange(setIn(doc, ["actors", index, "presence"], value))}
							/>
							<Select
								label="他要不要抢注意力"
								data={DEMANDS}
								allowDeselect={false}
								value={textAt(doc, "actors", index, "demand") || "neutral"}
								onChange={(value) => value && onChange(setIn(doc, ["actors", index, "demand"], value))}
							/>
						</Group>
						<KeyValueEditor
							label="这个人知道什么（信息隔离边界）"
							hint="他没说出口的、学生也问不到的，模型不许替他说。值可以是文字/数字/布尔。"
							doc={doc}
							path={["actors", index, "knowledge"]}
							onChange={onChange}
							newKeyPrefix="事项"
						/>
					</>
				)}
			/>
		</Section>
	);
}

function StateSection({ doc, onChange, issues }: SectionProps) {
	const entries = Object.entries(tableAt(doc, "state_keys"));
	const bounds = tableAt(doc, "state_bounds");

	/** 改名时把边界一起搬过去（键是边界表的身份，留下旧键就是一条脏数据）。 */
	const rename = (from: string, to: string) => {
		const nextKeys: Record<string, ScenarioPackValue> = {};
		for (const [key, value] of entries) nextKeys[key === from ? to : key] = value;
		const nextBounds: Record<string, ScenarioPackValue> = {};
		for (const [key, value] of Object.entries(bounds)) nextBounds[key === from ? to : key] = value;
		onChange(setIn(setIn(doc, ["state_keys"], nextKeys), ["state_bounds"], nextBounds));
	};

	const remove = (key: string) => onChange(deleteIn(deleteIn(doc, ["state_keys", key]), ["state_bounds", key]));

	return (
		<Section
			id="state"
			title="状态键与边界"
			hint="键写成 <目标>.<名字>（目标是人物 id 或 scene）；模型只能改这里登记过的键，数值键的边界越界即拒。"
			issues={issuesOf(issues, "state")}
		>
			<Stack gap="sm">
				{entries.length === 0 && (
					<Text size="xs" c="dimmed">
						还没有登记状态键。设备读数、效果、失败条件都从这张表里选。
					</Text>
				)}
				{entries.map(([key, value], index) => {
					const numeric = typeof value === "number";
					const bound = (bounds[key] ?? {}) as Record<string, ScenarioPackValue>;
					return (
						<Group key={`${key}-${index}`} align="flex-end" gap="xs" wrap="wrap">
							<TextInput
								label={index === 0 ? "状态键" : undefined}
								description={index === 0 ? "如 scene.spo2" : undefined}
								value={key}
								onChange={(event) => rename(key, event.currentTarget.value)}
								w={200}
							/>
							<ScalarValueInput
								label={index === 0 ? "初值" : undefined}
								value={value}
								onChange={(next) => onChange(setIn(doc, ["state_keys", key], next))}
							/>
							{numeric && (
								<>
									<NumberInput
										label={index === 0 ? "下界" : undefined}
										value={typeof bound.lo === "number" ? bound.lo : ""}
										onChange={(next) =>
											onChange(
												setIn(doc, ["state_bounds", key], {
													...bound,
													lo: typeof next === "number" ? next : null,
												}),
											)
										}
										w={110}
									/>
									<NumberInput
										label={index === 0 ? "上界" : undefined}
										value={typeof bound.hi === "number" ? bound.hi : ""}
										onChange={(next) =>
											onChange(
												setIn(doc, ["state_bounds", key], {
													...bound,
													hi: typeof next === "number" ? next : null,
												}),
											)
										}
										w={110}
									/>
								</>
							)}
							<Text size="xs" c="dimmed">
								{shortKey(key)}
							</Text>
							<ActionIcon
								variant="subtle"
								color="red"
								aria-label="删除状态键"
								onClick={() => remove(key)}
							>
								<IconX size={14} />
							</ActionIcon>
						</Group>
					);
				})}
				<Group>
					<Button
						variant="light"
						size="compact-sm"
						leftSection={<IconPlus size={14} />}
						onClick={() => {
							let suffix = entries.length + 1;
							while (`scene.key_${suffix}` in (tableAt(doc, "state_keys") as object)) suffix += 1;
							onChange(setIn(doc, ["state_keys", `scene.key_${suffix}`], ""));
						}}
					>
						添加状态键
					</Button>
				</Group>
			</Stack>
		</Section>
	);
}

function AffordancesSection({ doc, onChange, issues, refs }: SectionProps) {
	const affordances = listAt<ScenarioPackValue>(doc, "affordances");
	return (
		<Section
			id="affordances"
			title="动作"
			hint="学生能做的事。类型封闭（ask/observe/measure/act/document/summon）；「记录」需要表单字段，单选/多选需要选项。"
			issues={issuesOf(issues, "affordances")}
		>
			<ListEditor
				items={affordances}
				onChange={(value) => onChange(setIn(doc, ["affordances"], value))}
				create={() => ({ id: "a_new", type: "act", label: "", time_cost: 0 })}
				addLabel="添加动作"
				emptyText="还没有声明任何动作。"
				render={(_item, index) => {
					const type = textAt(doc, "affordances", index, "type") || "act";
					const select = textAt(doc, "affordances", index, "select") || "none";
					const path = ["affordances", index];
					return (
						<>
							<Group grow align="flex-start">
								<TextInput
									label="id"
									value={textAt(doc, "affordances", index, "id")}
									onChange={(event) =>
										onChange(setIn(doc, ["affordances", index, "id"], event.currentTarget.value))
									}
								/>
								<TextInput
									label="标签"
									description="学生看到的按钮文案；不得泄露未揭示的真相"
									value={textAt(doc, "affordances", index, "label")}
									onChange={(event) =>
										onChange(setIn(doc, ["affordances", index, "label"], event.currentTarget.value))
									}
								/>
							</Group>
							<Group grow align="flex-start">
								<Select
									label="类型"
									data={AFFORDANCE_TYPES}
									allowDeselect={false}
									value={type}
									onChange={(value) => value && onChange(setIn(doc, ["affordances", index, "type"], value))}
								/>
								<Select
									label="呈现形态"
									data={[
										{ value: "none", label: "直接执行" },
										{ value: "single", label: "单选（需选项）" },
										{ value: "multi", label: "多选（需选项）" },
									]}
									allowDeselect={false}
									value={select}
									onChange={(value) => value && onChange(setIn(doc, ["affordances", index, "select"], value))}
								/>
								<NumberInput
									label="耗时（情境时间单位）"
									description="0 = 瞬时"
									min={0}
									max={60}
									value={numberAt(doc, [...path, "time_cost"], 0)}
									onChange={(value) =>
										onChange(setIn(doc, ["affordances", index, "time_cost"], typeof value === "number" ? value : 0))
									}
								/>
							</Group>
							<Group gap="lg">
								<Switch
									label="自输入"
									checked={nodeAt(doc, ...path, "free_input") !== false}
									onChange={(event) =>
										onChange(setIn(doc, ["affordances", index, "free_input"], event.currentTarget.checked))
									}
								/>
								<Switch
									label="二次确认（危险动作）"
									checked={nodeAt(doc, ...path, "confirm") === true}
									onChange={(event) =>
										onChange(setIn(doc, ["affordances", index, "confirm"], event.currentTarget.checked))
									}
								/>
							</Group>
							<MultiSelect
								label="揭示哪些线索"
								description="学生做这个动作，这些线索就放出来（从已声明的线索里选）"
								data={refs.cues}
								searchable
								value={listAt<string>(doc, "affordances", index, "reveals")}
								onChange={(value) => onChange(setIn(doc, ["affordances", index, "reveals"], value))}
							/>
							<Group>
								<Text size="xs" c="dimmed">
									可作用的目标（空 = 全场级，不对准谁）
								</Text>
							</Group>
							<TargetListEditor
								doc={doc}
								path={[...path, "targets"]}
								onChange={onChange}
								refs={refs}
							/>
							<Group>
								<Text size="xs" c="dimmed">
									确定性效果（学生点下去就一定发生）
								</Text>
							</Group>
							<EffectListEditor doc={doc} path={[...path, "effects"]} onChange={onChange} refs={refs} />
							{type === "document" && (
								<StringListRow
									label="表单字段"
									items={listAt<string>(doc, "affordances", index, "params", "fields")}
									onChange={(value) => onChange(setIn(doc, ["affordances", index, "params", "fields"], value))}
									addLabel="添加字段"
									emptyText="记录型动作需要至少一个表单字段。"
									placeholder="如「测量值」"
								/>
							)}
							{select !== "none" && (
								<ListEditor
									items={listAt<ScenarioPackValue>(doc, "affordances", index, "params", "options")}
									onChange={(value) =>
										onChange(setIn(doc, ["affordances", index, "params", "options"], value))
									}
									create={() => ({ id: "o_new", label: "" })}
									addLabel="添加选项"
									emptyText="单选/多选至少要有一个选项。"
									render={(_option, optionIndex) => (
										<Group grow align="flex-start">
											<TextInput
												label="选项 id"
												value={textAt(doc, "affordances", index, "params", "options", optionIndex, "id")}
												onChange={(event) =>
													onChange(
														setIn(
															doc,
															["affordances", index, "params", "options", optionIndex, "id"],
															event.currentTarget.value,
														),
													)
												}
											/>
											<TextInput
												label="选项文案"
												value={textAt(doc, "affordances", index, "params", "options", optionIndex, "label")}
												onChange={(event) =>
													onChange(
														setIn(
															doc,
															["affordances", index, "params", "options", optionIndex, "label"],
															event.currentTarget.value,
														),
													)
												}
											/>
										</Group>
									)}
								/>
							)}
							<TriggerEditor
								title="什么时候出现"
								hint="省略 = 一直可用；按条件出现时，全部条件同时成立它才出现。"
								doc={doc}
								path={[...path, "visible_when"]}
								onChange={onChange}
								refs={refs}
							/>
						</>
					);
				}}
			/>
		</Section>
	);
}

function FactsSection({ doc, onChange, issues, refs }: SectionProps) {
	return (
		<Section
			id="facts"
			title="事实"
			hint="判读要观察到的条目：靠「哪条线索被揭示 / 哪个动作被用过」判定是否采集到。"
			issues={issuesOf(issues, "facts")}
		>
			<ListEditor
				items={listAt<ScenarioPackValue>(doc, "facts")}
				onChange={(value) => onChange(setIn(doc, ["facts"], value))}
				create={() => ({ id: "f_new", intent: "", critical: false, cue_ids: [], affordance_ids: [] })}
				addLabel="添加事实"
				emptyText="还没有声明事实。"
				render={(_fact, index) => (
					<>
						<Group grow align="flex-start">
							<TextInput
								label="id"
								value={textAt(doc, "facts", index, "id")}
								onChange={(event) => onChange(setIn(doc, ["facts", index, "id"], event.currentTarget.value))}
							/>
							<Switch
								label="关键"
								mt="xl"
								checked={nodeAt(doc, "facts", index, "critical") === true}
								onChange={(event) =>
									onChange(setIn(doc, ["facts", index, "critical"], event.currentTarget.checked))
								}
							/>
						</Group>
						<Textarea
							label="意图描述"
							description="给判读用；不会出现在按钮文案里"
							autosize
							minRows={2}
							value={textAt(doc, "facts", index, "intent")}
							onChange={(event) => onChange(setIn(doc, ["facts", index, "intent"], event.currentTarget.value))}
						/>
						<MultiSelect
							label="靠哪些线索算采集到"
							data={refs.cues}
							searchable
							value={listAt<string>(doc, "facts", index, "cue_ids")}
							onChange={(value) => onChange(setIn(doc, ["facts", index, "cue_ids"], value))}
						/>
						<MultiSelect
							label="靠哪些动作算采集到"
							data={refs.affordances}
							searchable
							value={listAt<string>(doc, "facts", index, "affordance_ids")}
							onChange={(value) => onChange(setIn(doc, ["facts", index, "affordance_ids"], value))}
						/>
						<StringListRow
							label="禁用词（按钮/选项文案里出现即算泄底）"
							items={listAt<string>(doc, "facts", index, "banned_phrases")}
							onChange={(value) => onChange(setIn(doc, ["facts", index, "banned_phrases"], value))}
							addLabel="添加禁用词"
							emptyText="没有额外声明的禁用词（事实 id 与意图描述里的词本来就会自动算）。"
							placeholder="如「血性」"
						/>
					</>
				)}
			/>
		</Section>
	);
}

/** 一条判据的参数：形状由规则决定，所以这里也按规则给不同的格子。 */
function RuleParams({
	doc,
	onChange,
	index,
	refs,
}: {
	doc: ScenarioPackDoc;
	onChange: Change;
	index: number;
	refs: RefOptions;
}) {
	const path = ["rubric", index, "params"];
	const rule = textAt(doc, "rubric", index, "rule");
	const ids = (key: string) => listAt<string>(doc, "rubric", index, "params", key);
	// 选型判据的正确项可以写动作 id，也可以写选项 id（学生选中的是选项）
	const choiceIds = [
		...refs.affordances,
		...listAt<Record<string, ScenarioPackValue>>(doc, "affordances").flatMap((_, aIndex) =>
			listAt<Record<string, ScenarioPackValue>>(doc, "affordances", aIndex, "params", "options").map(
				(_option, oIndex) => textAt(doc, "affordances", aIndex, "params", "options", oIndex, "id"),
			),
		),
	].filter((id) => id !== "");
	const number = (key: string, label: string, fallback: number, description?: string) => (
		<NumberInput
			label={label}
			description={description}
			value={numberAt(doc, [...path, key], fallback)}
			onChange={(value) => onChange(setIn(doc, [...path, key], typeof value === "number" ? value : fallback))}
			w={160}
		/>
	);
	const multi = (key: string, label: string, data: string[]) => (
		<MultiSelect
			label={label}
			data={data}
			searchable
			value={ids(key)}
			onChange={(value) => onChange(setIn(doc, [...path, key], value))}
		/>
	);

	if (rule === "first_action") {
		return (
			<Stack gap="xs">
				{multi("affordances", "目标动作集合（从已声明的动作里选）", refs.affordances)}
				<Switch
					label="首个动作应当属于这个集合"
					checked={nodeAt(doc, ...path, "belongs") !== false}
					onChange={(event) => onChange(setIn(doc, [...path, "belongs"], event.currentTarget.checked))}
				/>
			</Stack>
		);
	}
	if (rule === "avoid_repeat") {
		return (
			<Group align="flex-end" gap="xs" wrap="wrap">
				<Select
					label="不能重复的动作"
					data={refs.affordances}
					searchable
					value={textAt(doc, "rubric", index, "params", "affordance_id") || null}
					onChange={(value) => value && onChange(setIn(doc, [...path, "affordance_id"], value))}
					w={220}
				/>
				{number("max", "允许次数上限", 1, "超过 +1 合格、再多算漏")}
			</Group>
		);
	}
	if (rule === "require_within") {
		return (
			<Group align="flex-end" gap="xs" wrap="wrap">
				{number("within_turns", "时间窗口（时间单位）", 0)}
				{multi("affordances", "窗口内要做到的动作", refs.affordances)}
			</Group>
		);
	}
	if (rule === "action_order") {
		return (
			<Stack gap="xs">
				{multi("first", "应当先做的动作", refs.affordances)}
				{multi("then", "应当在后面的动作", refs.affordances)}
			</Stack>
		);
	}
	if (rule === "option_choice") {
		return (
			<Stack gap="xs">
				{multi("affordances", "评哪些动作", refs.affordances)}
				{multi("correct", "选它算做对（动作 id 或选项 id）", choiceIds)}
				{multi("acceptable", "选它算合格", choiceIds)}
				<StringListRow
					label="自输入命中这些词也算做对"
					items={ids("accept_custom")}
					onChange={(value) => onChange(setIn(doc, [...path, "accept_custom"], value))}
					addLabel="添加词"
					emptyText="没有额外声明的自输入词。"
					placeholder="如「痰栓」"
				/>
			</Stack>
		);
	}
	return (
		<Group align="flex-end" gap="xs" wrap="wrap">
			{multi("affordances", "目标动作（覆盖度从这里算）", refs.affordances)}
			{number("min", "至少覆盖几项", 1)}
			<StringListRow
				label="自输入命中这些词额外算一项"
				items={ids("accept_custom")}
				onChange={(value) => onChange(setIn(doc, [...path, "accept_custom"], value))}
				addLabel="添加词"
				emptyText="没有额外声明的自输入词。"
				placeholder="如「听诊」"
			/>
		</Group>
	);
}

function RubricSection({ doc, onChange, issues, refs }: SectionProps) {
	return (
		<Section
			id="rubric"
			title="判据"
			hint="规则 + 三档判读文本 + 权重（1–100，全包合计 100 最好心算）。参数按规则给格子，引用都从已有 id 里选。"
			issues={issuesOf(issues, "rubric")}
		>
			<ListEditor
				items={listAt<ScenarioPackValue>(doc, "rubric")}
				onChange={(value) => onChange(setIn(doc, ["rubric"], value))}
				create={() => ({
					id: "dp_new",
					title: "",
					rule: "action_set_covers",
					params: defaultParams("action_set_covers"),
					anchors: { strong: "", adequate: "", missed: "" },
					weight: 1,
				})}
				addLabel="添加判据"
				emptyText="还没有声明判据（这个病例不产生判读）。"
				render={(_point, index) => (
					<>
						<Group grow align="flex-start">
							<TextInput
								label="id"
								value={textAt(doc, "rubric", index, "id")}
								onChange={(event) => onChange(setIn(doc, ["rubric", index, "id"], event.currentTarget.value))}
							/>
							<Select
								label="规则"
								data={JUDGE_RULES}
								allowDeselect={false}
								value={textAt(doc, "rubric", index, "rule") || "action_set_covers"}
								onChange={(value) =>
									value &&
									onChange(
										setIn(
											setIn(doc, ["rubric", index, "rule"], value),
											["rubric", index, "params"],
											defaultParams(value),
										),
									)
								}
							/>
							<NumberInput
								label="权重"
								min={1}
								max={100}
								value={numberAt(doc, ["rubric", index, "weight"], 1)}
								onChange={(value) =>
									onChange(setIn(doc, ["rubric", index, "weight"], typeof value === "number" ? value : 1))
								}
							/>
						</Group>
						<TextInput
							label="这条在评什么"
							description="一句话说清；进报告，不进模型提示词"
							value={textAt(doc, "rubric", index, "title")}
							onChange={(event) => onChange(setIn(doc, ["rubric", index, "title"], event.currentTarget.value))}
						/>
						<RuleParams doc={doc} onChange={onChange} index={index} refs={refs} />
						{(["strong", "adequate", "missed"] as const).map((anchor) => (
							<Textarea
								key={anchor}
								label={
									anchor === "strong" ? "判读 · 强（做对了）" : anchor === "adequate" ? "判读 · 合格" : "判读 · 漏了"
								}
								autosize
								minRows={2}
								value={textAt(doc, "rubric", index, "anchors", anchor)}
								onChange={(event) =>
									onChange(setIn(doc, ["rubric", index, "anchors", anchor], event.currentTarget.value))
								}
							/>
						))}
					</>
				)}
			/>
		</Section>
	);
}

/** 一段数值区间（正常区间 / 危急区间）：两格都填才算声明。 */
function NumberRange({
	label,
	value,
	onChange,
}: {
	label: string;
	value: ScenarioPackValue | undefined;
	onChange: (next: ScenarioPackValue) => void;
}) {
	const span = Array.isArray(value) ? value : null;
	const part = (index: number) =>
		span !== null && typeof span[index] === "number" ? (span[index] as number) : "";
	const write = (index: number, next: string | number) =>
		onChange([
			index === 0 ? (typeof next === "number" ? next : 0) : typeof part(0) === "number" ? part(0) : 0,
			index === 1 ? (typeof next === "number" ? next : 0) : typeof part(1) === "number" ? part(1) : 0,
		]);
	return (
		<Group align="flex-end" gap="xs" wrap="nowrap">
			<Text size="xs" c="dimmed" w={70}>
				{label}
			</Text>
			<NumberInput
				label="下"
				value={part(0)}
				onChange={(next) => write(0, next)}
				w={90}
			/>
			<NumberInput label="上" value={part(1)} onChange={(next) => write(1, next)} w={90} />
			{span !== null && (
				<Text
					size="xs"
					c="red"
					style={{ cursor: "pointer" }}
					onClick={() => onChange(null)}
				>
					清除
				</Text>
			)}
		</Group>
	);
}

function DevicesSection({ doc, onChange, issues, refs }: SectionProps) {
	return (
		<Section
			id="devices"
			title="设备"
			hint="要给学生看的读数都必须挂在这里（读数归设备面板）；通道的状态键从已登记的键里选。"
			issues={issuesOf(issues, "devices")}
		>
			<ListEditor
				items={listAt<ScenarioPackValue>(doc, "presentation", "devices")}
				onChange={(value) => onChange(setIn(doc, ["presentation", "devices"], value))}
				create={() => ({ id: "dev_new", kind: "monitor", title: "", channels: [], sound: "off" })}
				addLabel="添加设备"
				emptyText="没有声明设备。"
				render={(_device, index) => (
					<>
						<Group grow align="flex-start">
							<TextInput
								label="id"
								value={textAt(doc, "presentation", "devices", index, "id")}
								onChange={(event) =>
									onChange(setIn(doc, ["presentation", "devices", index, "id"], event.currentTarget.value))
								}
							/>
							<TextInput
								label="设备名"
								value={textAt(doc, "presentation", "devices", index, "title")}
								onChange={(event) =>
									onChange(setIn(doc, ["presentation", "devices", index, "title"], event.currentTarget.value))
								}
							/>
							<Select
								label="种类"
								data={DEVICE_KINDS}
								allowDeselect={false}
								value={textAt(doc, "presentation", "devices", index, "kind") || "monitor"}
								onChange={(value) =>
									value && onChange(setIn(doc, ["presentation", "devices", index, "kind"], value))
								}
							/>
							<Switch
								label="提示音"
								mt="xl"
								checked={textAt(doc, "presentation", "devices", index, "sound") === "beep"}
								onChange={(event) =>
									onChange(
										setIn(
											doc,
											["presentation", "devices", index, "sound"],
											event.currentTarget.checked ? "beep" : "off",
										),
									)
								}
							/>
						</Group>
						<TriggerEditor
							title="整台设备什么时候出现"
							doc={doc}
							path={["presentation", "devices", index, "visible_when"]}
							onChange={onChange}
							refs={refs}
						/>
						<Group>
							<Text size="xs" c="dimmed">
								通道（每个通道显示一个已登记的状态键）
							</Text>
						</Group>
						<ListEditor
							items={listAt<ScenarioPackValue>(doc, "presentation", "devices", index, "channels")}
							onChange={(value) =>
								onChange(setIn(doc, ["presentation", "devices", index, "channels"], value))
							}
							create={() => ({ ref: refs.stateKeys[0] ?? "", label: "" })}
							addLabel="添加通道"
							emptyText="这台设备还没有通道。"
							render={(_channel, channelIndex) => (
								<>
									<Group grow align="flex-start">
										<Select
											label="状态键"
											description="从已登记的状态键里选"
											data={refs.stateKeys}
											searchable
											allowDeselect={false}
											value={
												textAt(doc, "presentation", "devices", index, "channels", channelIndex, "ref") ||
												null
											}
											onChange={(value) =>
												value &&
												onChange(
													setIn(
														doc,
														["presentation", "devices", index, "channels", channelIndex, "ref"],
														value,
													),
												)
											}
										/>
										<TextInput
											label="显示名"
											value={textAt(
												doc,
												"presentation",
												"devices",
												index,
												"channels",
												channelIndex,
												"label",
											)}
											onChange={(event) =>
												onChange(
													setIn(
														doc,
														["presentation", "devices", index, "channels", channelIndex, "label"],
														event.currentTarget.value,
													),
												)
											}
										/>
										<TextInput
											label="单位"
											value={textAt(
												doc,
												"presentation",
												"devices",
												index,
												"channels",
												channelIndex,
												"unit",
											)}
											onChange={(event) =>
												onChange(
													setIn(
														doc,
														["presentation", "devices", index, "channels", channelIndex, "unit"],
														event.currentTarget.value,
													),
												)
											}
										/>
									</Group>
									<Group grow align="flex-end" wrap="wrap">
										<NumberInput
											label="小数位"
											min={0}
											value={numberAt(
												doc,
												["presentation", "devices", index, "channels", channelIndex, "decimals"],
												0,
											)}
											onChange={(value) =>
												onChange(
													setIn(
														doc,
														["presentation", "devices", index, "channels", channelIndex, "decimals"],
														typeof value === "number" ? value : 0,
													),
												)
											}
										/>
										<Switch
											label="给趋势"
											mt="xl"
											checked={
												nodeAt(
													doc,
													"presentation",
													"devices",
													index,
													"channels",
													channelIndex,
													"trend",
												) !== false
											}
											onChange={(event) =>
												onChange(
													setIn(
														doc,
														["presentation", "devices", index, "channels", channelIndex, "trend"],
														event.currentTarget.checked,
													),
												)
											}
										/>
									</Group>
									<NumberRange
										label="正常区间"
										value={nodeAt(
											doc,
											"presentation",
											"devices",
											index,
											"channels",
											channelIndex,
											"normal",
										)}
										onChange={(next) =>
											onChange(
												setIn(
													doc,
													["presentation", "devices", index, "channels", channelIndex, "normal"],
													next,
												),
											)
										}
									/>
									<NumberRange
										label="危急区间"
										value={nodeAt(
											doc,
											"presentation",
											"devices",
											index,
											"channels",
											channelIndex,
											"critical",
										)}
										onChange={(next) =>
											onChange(
												setIn(
													doc,
													["presentation", "devices", index, "channels", channelIndex, "critical"],
													next,
												),
											)
										}
									/>
									<TriggerEditor
										title="这个通道什么时候出现"
										doc={doc}
										path={[
											"presentation",
											"devices",
											index,
											"channels",
											channelIndex,
											"visible_when",
										]}
										onChange={onChange}
										refs={refs}
									/>
								</>
							)}
						/>
					</>
				)}
			/>
		</Section>
	);
}

function FailureSection({ doc, onChange, issues, refs }: SectionProps) {
	const failure = textAt(doc, "failure") || "recoverable";
	return (
		<Section
			id="failure"
			title="结局"
			hint="不可逆结局必须给出条件（全部条件同时成立即判负）；给得出结局的病例才有「输」。"
			issues={issuesOf(issues, "failure")}
		>
			<Stack gap="sm">
				<Select
					label="结局类型"
					data={[
						{ value: "recoverable", label: "recoverable · 怎样都还能救" },
						{ value: "irreversible", label: "irreversible · 有不可逆的输" },
					]}
					allowDeselect={false}
					value={failure}
					onChange={(value) => value && onChange(setIn(doc, ["failure"], value))}
					w={280}
				/>
				<TriggerEditor
					title="不可逆失败条件"
					switchLabel="有失败条件"
					hint={
						failure === "irreversible"
							? "这个病例声明了不可逆结局，条件不能为空。"
							: "这个病例没有不可逆结局；填了也不会触发（改结局类型才生效）。"
					}
					doc={doc}
					path={["failure_when"]}
					onChange={onChange}
					refs={refs}
				/>
			</Stack>
		</Section>
	);
}
