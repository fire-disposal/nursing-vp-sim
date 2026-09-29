/**
 * 场景编辑器的**表单页签**：只暴露必须由人决定的字段，按 pack 结构分节。
 *
 * 取向（docs/scenario.md P0-3）：
 * - 列表字段（线索/在场者/动作/事实/判据/维度/教学关注点/设备）一律可增删排序；
 * - 其余字段**保持原值**、折叠在一处（作者看不到就等于不存在），要改它们去「JSON 原始」页签；
 * - 节内的校验问题来自后端（`POST .../validate`），这里只**归位**不重算——
 *   路径映射是 `sectionForPath`，节标题上的红字与顶部摘要指向同一处。
 */

import {
	Accordion,
	Badge,
	Code,
	Group,
	MultiSelect,
	NumberInput,
	Select,
	Stack,
	Switch,
	Text,
	Textarea,
	TextInput,
} from "@mantine/core";
import type { ScenarioPackDoc, ScenarioPackProblem, ScenarioPackValue } from "@/api/scenario";
import { ListEditor, Section } from "./PackFormBits";
import { boolAt, listAt, numberAt, setIn, textAt } from "./packDoc";

/** 每一节覆盖哪些字段前缀（顶部摘要据此把问题指到节）。 */
export const PACK_SECTIONS: { id: string; label: string; prefixes: string[] }[] = [
	{ id: "basic", label: "基本信息", prefixes: ["title", "one_line", "player", "key", "pack_schema_version"] },
	{ id: "setting", label: "场景", prefixes: ["setting.place", "setting.time_hint", "setting.resources"] },
	{ id: "actors", label: "在场者", prefixes: ["actors"] },
	{ id: "affordances", label: "可做动作", prefixes: ["affordances"] },
	{ id: "cues", label: "线索与事实", prefixes: ["setting.cues", "facts"] },
	{ id: "rubric", label: "判读", prefixes: ["rubric", "dims"] },
	{ id: "teaching_focus", label: "教学关注点", prefixes: ["teaching_focus"] },
	{ id: "presentation", label: "呈现", prefixes: ["presentation", "assets", "failure"] },
];

/** 一条校验问题属于哪一节（认不出 → `null`，只在顶部摘要里列出）。 */
export function sectionForPath(path: string): string | null {
	const hit = PACK_SECTIONS.find((section) =>
		section.prefixes.some(
			(prefix) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`),
		),
	);
	return hit?.id ?? null;
}

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

const JUDGE_RULES = [
	"first_action",
	"avoid_repeat",
	"require_within",
	"action_set_covers",
	"action_order",
	"option_choice",
].map((value) => ({ value, label: value }));

const DIM_AGGS = ["coverage", "slope", "latency", "count"].map((value) => ({ value, label: value }));

const PANELS = ["timeline", "emotion", "coverage"].map((value) => ({ value, label: value }));

/** 表单编辑不到的**顶层**字段：折叠在一处，向作者交代"它们是原样保留的"。 */
const ADVANCED_KEYS = [
	"state_keys",
	"truth",
	"reactions",
	"assets",
	"hidden_from_player",
	"failure",
	"failure_when",
	"presentation",
];

type Change = (next: ScenarioPackDoc) => void;

export default function PackForm({
	doc,
	onChange,
	problems,
}: {
	doc: ScenarioPackDoc;
	onChange: Change;
	problems: ScenarioPackProblem[];
}) {
	const issuesOf = (id: string) => problems.filter((problem) => sectionForPath(problem.path) === id);
	const cues = listAt<ScenarioPackValue>(doc, "setting", "cues");
	const affordances = listAt<ScenarioPackValue>(doc, "affordances");
	// 已登记的 id：喂给事实的两组多选（作者选，而不是手打 id 拼写）
	const cueIds = cues.map((_, index) => textAt(doc, "setting", "cues", index, "id")).filter((id) => id !== "");
	const affordanceIds = affordances
		.map((_, index) => textAt(doc, "affordances", index, "id"))
		.filter((id) => id !== "");

	return (
		<Stack gap="md">
			<Section
				id="basic"
				title="基本信息"
				hint="标题与一句话会出现在学生入口页；key 是病例身份，不能改。"
				issues={issuesOf("basic")}
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
					<MultiSelect
						label="可用的动作类型"
						description="玩家能做的事的类型上限；动作里用了不在其中的类型会被判为问题"
						data={AFFORDANCE_TYPES}
						value={listAt<string>(doc, "player", "can")}
						onChange={(value) => onChange(setIn(doc, ["player", "can"], value))}
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

			<Section
				id="setting"
				title="场景"
				hint="地点、时间线索与手边可用的东西。"
				issues={issuesOf("setting")}
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
					<ListEditor
						items={listAt<string>(doc, "setting", "resources")}
						onChange={(value) => onChange(setIn(doc, ["setting", "resources"], value))}
						create={() => ""}
						addLabel="添加资源"
						emptyText="还没有声明手边有什么。"
						render={(item, index) => (
							<TextInput
								value={item}
								placeholder="如「床旁吸引器」"
								onChange={(event) => onChange(setIn(doc, ["setting", "resources", index], event.currentTarget.value))}
							/>
						)}
					/>
				</Stack>
			</Section>

			<Section
				id="actors"
				title="在场者"
				hint="接触方式（presence）决定学生能不能搭上话；知识与风格等字段在「JSON 原始」页签里改。"
				issues={issuesOf("actors")}
			>
				<ListEditor
					items={listAt<ScenarioPackValue>(doc, "actors")}
					onChange={(value) => onChange(setIn(doc, ["actors"], value))}
					create={() => ({ id: "actor_new", role: "", presence: "on_site", style: "", goals: [] })}
					addLabel="添加在场者"
					emptyText="还没有声明任何在场者。"
					render={(_item, index) => (
						<>
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
							<Select
								label="接触方式"
								data={PRESENCES}
								value={textAt(doc, "actors", index, "presence") || "on_site"}
								onChange={(value) => value && onChange(setIn(doc, ["actors", index, "presence"], value))}
							/>
							<Textarea
								label="说话与行事风格"
								autosize
								minRows={2}
								value={textAt(doc, "actors", index, "style")}
								onChange={(event) => onChange(setIn(doc, ["actors", index, "style"], event.currentTarget.value))}
							/>
							<ListEditor
								items={listAt<string>(doc, "actors", index, "goals")}
								onChange={(value) => onChange(setIn(doc, ["actors", index, "goals"], value))}
								create={() => ""}
								addLabel="添加目标"
								emptyText="没有声明的目标。"
								render={(goal, goalIndex) => (
									<TextInput
										value={goal}
										onChange={(event) =>
											onChange(setIn(doc, ["actors", index, "goals", goalIndex], event.currentTarget.value))
										}
									/>
								)}
							/>
						</>
					)}
				/>
			</Section>

			<Section
				id="affordances"
				title="可做动作"
				hint="类型封闭（ask/observe/measure/act/document/summon）；「记录」即表单型，需要声明表单字段；单选/多选需要在选项里给出条目。"
				issues={issuesOf("affordances")}
			>
				<ListEditor
					items={affordances}
					onChange={(value) => onChange(setIn(doc, ["affordances"], value))}
					create={() => ({ id: "a_new", type: "act", label: "" })}
					addLabel="添加动作"
					emptyText="还没有声明任何动作。"
					render={(_item, index) => {
						const type = textAt(doc, "affordances", index, "type") || "act";
						const select = textAt(doc, "affordances", index, "select") || "none";
						const options = listAt<ScenarioPackValue>(doc, "affordances", index, "params", "options");
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
										description="学生看到的按钮文案"
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
										value={select}
										onChange={(value) => value && onChange(setIn(doc, ["affordances", index, "select"], value))}
									/>
									<Switch
										label="表单型（记录）"
										mt="xl"
										checked={type === "document"}
										onChange={(event) =>
											onChange(
												setIn(doc, ["affordances", index, "type"], event.currentTarget.checked ? "document" : "act"),
											)
										}
									/>
								</Group>
								{type === "document" && (
									<TextListRow
										label="表单字段"
										items={listAt<string>(doc, "affordances", index, "params", "fields")}
										onChange={(value) => onChange(setIn(doc, ["affordances", index, "params", "fields"], value))}
									/>
								)}
								{select !== "none" && (
									<ListEditor
										items={options}
										onChange={(value) => onChange(setIn(doc, ["affordances", index, "params", "options"], value))}
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
							</>
						);
					}}
				/>
			</Section>

			<Section
				id="cues"
				title="线索与事实"
				hint="线索是世界给人看的东西（什么时候揭示由动作决定）；事实是判读要观察到的条目，它靠「哪条线索/哪个动作被用过」判定。"
				issues={issuesOf("cues")}
			>
				<Stack gap="lg">
					<div>
						<Text size="sm" fw={600} mb={4}>
							现场线索
						</Text>
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
											checked={boolAt(doc, "setting", "cues", index, "visible_from_start")}
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
					</div>

					<div>
						<Text size="sm" fw={600} mb={4}>
							事实（判读要观察到的条目）
						</Text>
						<ListEditor
							items={listAt<ScenarioPackValue>(doc, "facts")}
							onChange={(value) => onChange(setIn(doc, ["facts"], value))}
							create={() => ({ id: "f_new", intent: "", kind: "reported", critical: false, cue_ids: [], affordance_ids: [] })}
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
										<Select
											label="来源"
											data={[
												{ value: "measured", label: "measured · 量出来的" },
												{ value: "reported", label: "reported · 口述的" },
											]}
											value={textAt(doc, "facts", index, "kind") || "reported"}
											onChange={(value) => value && onChange(setIn(doc, ["facts", index, "kind"], value))}
										/>
										<Switch
											label="关键"
											mt="xl"
											checked={boolAt(doc, "facts", index, "critical")}
											onChange={(event) =>
												onChange(setIn(doc, ["facts", index, "critical"], event.currentTarget.checked))
											}
										/>
									</Group>
									<Textarea
										label="意图描述"
										description="给抽取用；不会出现在按钮文案里"
										autosize
										minRows={2}
										value={textAt(doc, "facts", index, "intent")}
										onChange={(event) => onChange(setIn(doc, ["facts", index, "intent"], event.currentTarget.value))}
									/>
									<MultiSelect
										label="靠哪些线索算采集到"
										data={cueIds}
										value={listAt<string>(doc, "facts", index, "cue_ids")}
										onChange={(value) => onChange(setIn(doc, ["facts", index, "cue_ids"], value))}
									/>
									<MultiSelect
										label="靠哪些动作算采集到"
										data={affordanceIds}
										value={listAt<string>(doc, "facts", index, "affordance_ids")}
										onChange={(value) => onChange(setIn(doc, ["facts", index, "affordance_ids"], value))}
									/>
								</>
							)}
						/>
					</div>
				</Stack>
			</Section>

			<Section
				id="rubric"
				title="判读"
				hint="维度（聚合口径）与判据（规则 + 三档判读文本 + 权重）。判据的参数（引用哪些动作）在「JSON 原始」页签里改。"
				issues={issuesOf("rubric")}
			>
				<Stack gap="lg">
					<div>
						<Text size="sm" fw={600} mb={4}>
							维度
						</Text>
						<ListEditor
							items={listAt<ScenarioPackValue>(doc, "dims")}
							onChange={(value) => onChange(setIn(doc, ["dims"], value))}
							create={() => ({ id: "d_new", label: "", agg: "coverage", source: "actions", params: {} })}
							addLabel="添加维度"
							emptyText="还没有声明维度。"
							render={(_dim, index) => (
								<Group grow align="flex-start">
									<TextInput
										label="id"
										value={textAt(doc, "dims", index, "id")}
										onChange={(event) => onChange(setIn(doc, ["dims", index, "id"], event.currentTarget.value))}
									/>
									<TextInput
										label="名称"
										value={textAt(doc, "dims", index, "label")}
										onChange={(event) => onChange(setIn(doc, ["dims", index, "label"], event.currentTarget.value))}
									/>
									<Select
										label="聚合"
										data={DIM_AGGS}
										value={textAt(doc, "dims", index, "agg") || "coverage"}
										onChange={(value) => value && onChange(setIn(doc, ["dims", index, "agg"], value))}
									/>
									<Select
										label="来源"
										data={["facts", "actions", "state"].map((value) => ({ value, label: value }))}
										value={textAt(doc, "dims", index, "source") || "actions"}
										onChange={(value) => value && onChange(setIn(doc, ["dims", index, "source"], value))}
									/>
								</Group>
							)}
						/>
					</div>

					<div>
						<Text size="sm" fw={600} mb={4}>
							判据
						</Text>
						<ListEditor
							items={listAt<ScenarioPackValue>(doc, "rubric")}
							onChange={(value) => onChange(setIn(doc, ["rubric"], value))}
							create={() => ({
								id: "c_new",
								title: "",
								rule: "action_set_covers",
								params: { affordances: [] },
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
											value={textAt(doc, "rubric", index, "rule") || "action_set_covers"}
											onChange={(value) => value && onChange(setIn(doc, ["rubric", index, "rule"], value))}
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
										description="一句话说清；进报告，不进 DM 提示词"
										value={textAt(doc, "rubric", index, "title")}
										onChange={(event) => onChange(setIn(doc, ["rubric", index, "title"], event.currentTarget.value))}
									/>
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
					</div>
				</Stack>
			</Section>

			<Section
				id="teaching_focus"
				title="教学关注点"
				hint="作者希望学生遇到的判断问题（intent），以及「是否值得关注 / 是否已被处理」的观察条件。不推进世界、不解锁动作、不分阶段；relevant_when / addressed_when / evidence_refs（条件与回看定位）在「JSON 原始」页签里改。"
				issues={issuesOf("teaching_focus")}
			>
				<ListEditor
					items={listAt<ScenarioPackValue>(doc, "teaching_focus")}
					onChange={(value) => onChange(setIn(doc, ["teaching_focus"], value))}
					create={() => ({ id: "focus_new", intent: "", relevant_when: null, addressed_when: null, evidence_refs: [] })}
					addLabel="添加关注点"
					emptyText="没有声明教学关注点。"
					render={(_focus, index) => (
						<>
							<TextInput
								label="id"
								value={textAt(doc, "teaching_focus", index, "id")}
								onChange={(event) =>
									onChange(setIn(doc, ["teaching_focus", index, "id"], event.currentTarget.value))
								}
							/>
							<Textarea
								label="教学意图（intent）"
								description="只给 DM 与教师回放看，学生看不到"
								autosize
								minRows={2}
								value={textAt(doc, "teaching_focus", index, "intent")}
								onChange={(event) =>
									onChange(setIn(doc, ["teaching_focus", index, "intent"], event.currentTarget.value))
								}
							/>
						</>
					)}
				/>
			</Section>

			<Section
				id="presentation"
				title="呈现"
				hint="面板开关、设备（现场那台仪器）与图像生成开关。"
				issues={issuesOf("presentation")}
			>
				<Stack gap="sm">
					<MultiSelect
						label="面板"
						data={PANELS}
						value={listAt<string>(doc, "presentation", "panels")}
						onChange={(value) => onChange(setIn(doc, ["presentation", "panels"], value))}
					/>
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
										data={["monitor", "phone", "pump", "other"].map((value) => ({ value, label: value }))}
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
								<Text size="xs" c="dimmed">
									通道（channels）在「JSON 原始」页签里改。
								</Text>
							</>
						)}
					/>
				</Stack>
			</Section>

			<Accordion variant="separated">
				<Accordion.Item value="advanced">
					<Accordion.Control>
						<Group gap="xs">
							<Text size="sm">其余字段（原样保留）</Text>
							<Badge variant="light" color="gray">
								{ADVANCED_KEYS.length} 组
							</Badge>
						</Group>
					</Accordion.Control>
					<Accordion.Panel>
						<Text size="xs" c="dimmed" mb={4}>
							这些字段保存时按原值带走，本页签不提供编辑；要改它们请用「JSON 原始」页签。
						</Text>
						<Group gap={4}>
							{ADVANCED_KEYS.map((key) => (
								<Code key={key}>{key}</Code>
							))}
						</Group>
					</Accordion.Panel>
				</Accordion.Item>
			</Accordion>
		</Stack>
	);
}

/** 一串字符串字段（如 document 的 `params.fields`）：与 ListEditor 同形，但只有文本行。 */
function TextListRow({
	label,
	items,
	onChange,
}: {
	label: string;
	items: string[];
	onChange: (next: string[]) => void;
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
				addLabel="添加字段"
				emptyText="记录型动作需要至少一个表单字段。"
				render={(item, index) => (
					<TextInput
						value={item}
						placeholder="如「测量值」"
						onChange={(event) => onChange(items.map((value, position) => (position === index ? event.currentTarget.value : value)))}
					/>
				)}
			/>
		</div>
	);
}
