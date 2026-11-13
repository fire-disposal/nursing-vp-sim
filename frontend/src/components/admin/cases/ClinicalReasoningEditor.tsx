/**
 * 临床判断训练（``workflow: "clinical_reasoning"``）的作者面：六个紧凑页签的**教师表单**。
 *
 * 契约归属：键名 / 枚举 / 形状以 ``backend/schemas/case_schema.py`` 的 ``Clinical*`` 模型为唯一
 * owner；语义（引用完整性、锚点覆盖、证据可达性）由保存路径的 pydantic 校验与发布门禁
 * （``modules/cases/validator.py``）报出。本文件只负责**写入与展示**：不复制校验规则，
 * 不做发布门禁，不调用任何 API —— 与 ``BlueprintEditor`` / ``CapabilitiesEditor`` 同策。
 *
 * 为什么需要这份表单：临床判断病例的内容面（scenario / findings / initial / progression /
 * objectives / rubric）没有任何一只 Activity 承载，JSON 视图是教师唯一入口时等于要老师读写 schema。
 *
 * 引用字段一律用当前工作副本里的 id 做 ``Select`` / ``MultiSelect``：新增证据或目标后立刻
 * 出现在引用下拉里，不需要记忆 id。
 */

import {
	ActionIcon,
	Badge,
	Checkbox,
	Group,
	MultiSelect,
	NumberInput,
	Paper,
	Select,
	Stack,
	Tabs,
	TagsInput,
	Text,
	Textarea,
	TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { CaseBasicsSection } from "./CaseBasicsSection";
import type { CaseDispatch, CaseEditorState, CaseJsonValue } from "./CaseEditorState";
import { arrayField, objField, stringField } from "./CaseEditorState";
import { KeyValueEditor } from "./KeyValueEditor";
import { PatientSection } from "./PatientSection";
import { PersonalitySection } from "./PersonalitySection";

// ── 枚举（与后端 Clinical* StrEnum 一一对应；这里只给中文标签，不承担校验）────

/** ``ClinicalFindingKind``：证据种类 = 学生从哪种途径拿到它。 */
const FINDING_KIND_OPTIONS = [
	{ value: "vital_sign", label: "生命体征" },
	{ value: "exam", label: "查体" },
	{ value: "lab", label: "检验" },
	{ value: "history", label: "病史" },
	{ value: "observation", label: "观察" },
];

/** ``ClinicalTriggerKind``：未处置推进的触发条件（确定性，不由 LLM 判）。 */
const TRIGGER_KIND_OPTIONS = [
	{ value: "time", label: "时间" },
	{ value: "finding", label: "证据获取" },
	{ value: "objective", label: "目标达成" },
];

/** ``ClinicalRubricRule``：锚点判定规则 —— 能算的不用 LLM 判。 */
const RUBRIC_RULE_OPTIONS = [
	{ value: "finding_observed", label: "证据已观察" },
	{ value: "objective_met", label: "目标达成" },
	{ value: "action_taken", label: "完成行动" },
	{ value: "communicated", label: "完成沟通" },
];

/** 场景字段（顺序即表单顺序）。 */
const SCENARIO_FIELDS = [
	{ key: "title", label: "场景标题", placeholder: "如：术后低氧", hint: "≤120 字", multiline: false },
	{ key: "setting", label: "地点与时机", placeholder: "如：外科病房 · 术后 6 小时", hint: "≤200 字", multiline: false },
	{ key: "summary", label: "场景摘要", placeholder: "学生在这次训练里面对什么", hint: "≤2000 字", multiline: true },
	{
		key: "learner_brief",
		label: "任务简报",
		placeholder: "如：按阶段链完成：发现线索 → 获取证据 → 判断 → 行动 → 沟通",
		hint: "可选，展示给学生的任务说明",
		multiline: true,
	},
];

/** 三类目标（结构同 ``ClinicalObjectives``）；id 前缀不同，表单按组渲染。 */
const OBJECTIVE_GROUPS = [
	{ key: "must_notice", label: "必须发现", hint: "引用证据 id：遗漏它＝判断不可能正确" },
	{ key: "must_act", label: "必须行动", hint: "学生要完成的关键动作，可声明前置证据" },
	{ key: "must_communicate", label: "必须沟通", hint: "必须出现的关键沟通内容" },
];

/** 病史与背景（V2 上下文使用完整人物背景；``communication_style`` 由 PersonalitySection 维护）。 */
const HISTORY_FIELDS = [
	{ key: "opening_line", label: "开场白", placeholder: "患者进入场景时说的第一句话", multiline: false },
	{ key: "present_illness", label: "现病史", placeholder: "本次不适的发生、演变与伴随症状", multiline: true },
	{ key: "past_history", label: "既往史", placeholder: "既往疾病与手术史", multiline: true },
	{ key: "medication_history", label: "用药史", placeholder: "长期用药与近期用药", multiline: true },
	{ key: "allergy_history", label: "过敏史", placeholder: "药物/食物过敏", multiline: false },
	{ key: "family_history", label: "家族史", placeholder: "家族性疾病", multiline: false },
	{ key: "social_history", label: "社会史", placeholder: "吸烟、饮酒、职业、居住", multiline: true },
];

// ── 工具 ───────────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, CaseJsonValue> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(obj: Record<string, CaseJsonValue>, key: string): string {
	const v = obj[key];
	return typeof v === "string" ? v : "";
}

function strList(obj: Record<string, CaseJsonValue>, key: string): string[] {
	const v = obj[key];
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function textOf(v: CaseJsonValue | undefined): string {
	if (typeof v === "string") return v;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return "";
}

/** 行数组：非对象条目按空行处理，索引与 JSON 数组下标一致（写回不会错位）。 */
function rowsOf(list: CaseJsonValue[]): Record<string, CaseJsonValue>[] {
	return list.map((item) => (isObj(item) ? item : {}));
}

/** 写回一行：``patch`` 与旧行浅合并；``undefined`` = 删键（切换触发类型时清残留参数）。 */
function patchRow(
	rows: Record<string, CaseJsonValue>[],
	index: number,
	patch: Record<string, CaseJsonValue | undefined>,
): CaseJsonValue[] {
	return rows.map((row, i) => {
		if (i !== index) return row;
		const next: Record<string, CaseJsonValue> = { ...row };
		for (const [k, v] of Object.entries(patch)) {
			if (v === undefined) delete next[k];
			else next[k] = v;
		}
		return next;
	});
}

/**
 * 数值化：纯数字（含负号/小数）写成 number，其余原样返回字符串，空串 → undefined。
 *
 * 这是 ``state_changes`` 的关键一步：``{spo2: "84"}`` 会让运行时的数值比较静默失效
 * （字符串序下 "84" < 90），而 ``{consciousness: "drowsy"}`` 必须保持字符串。
 */
function parseScalar(raw: string): string | number | undefined {
	const t = raw.trim();
	if (t === "") return undefined;
	return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

/** 数字输入的回填值（空 = 未声明，交给后端报缺）。 */
function numberOrEmpty(v: CaseJsonValue | undefined): number | string {
	return typeof v === "number" && Number.isFinite(v) ? v : "";
}

/** 引用下拉：id → 「id · 标签」（缺标签时只显示 id，不编造名称）。 */
function idOptions(rows: Record<string, CaseJsonValue>[]): { value: string; label: string }[] {
	const seen = new Set<string>();
	const out: { value: string; label: string }[] = [];
	for (const row of rows) {
		const id = str(row, "id").trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const label = str(row, "label").trim();
		out.push({ value: id, label: label ? `${id} · ${label}` : id });
	}
	return out;
}

// ── 展示件 ────────────────────────────────────────────────────────────────

/** 标签 + 可选说明 + 控件。 */
function FieldBlock({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div>
			<Text size="xs" fw={600} c="dimmed" mb={4}>{label}</Text>
			{hint && <Text size="xs" c="dimmed" opacity={0.7} mb={4}>{hint}</Text>}
			{children}
		</div>
	);
}

/** 清单底部「+ 添加」：六处同名动作共用一份形状。 */
function AddRowButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
	return (
		<Group gap={8}>
			<ActionIcon variant="light" color="blue" onClick={onClick} disabled={disabled} aria-label={`添加${label}`}>
				<IconPlus size={14} />
			</ActionIcon>
			<Text size="xs" c="dimmed">添加{label}</Text>
		</Group>
	);
}

// ── state_changes ─────────────────────────────────────────────────────────

interface StateChangesProps {
	value: Record<string, CaseJsonValue>;
	onChange: (v: Record<string, CaseJsonValue>) => void;
	disabled?: boolean;
	/** 无障碍名前缀（同一表单里多条推进各有一份状态变化）。 */
	labelPrefix: string;
	keyPlaceholder?: string;
}

/**
 * 键值编辑器：`state_changes`（数字写成 number）与 `deep_background`（纯文本）共用。
 *
 * 数字化只作用于 `state_changes`：`{spo2: "84"}` 会让运行时的数值比较静默失效（字符串序），
 * 而 `{consciousness: "drowsy"}` 必须保持字符串 —— 所以形如 `-?\d+(\.\d+)?` 的输入写 number，
 * 其余原样写字符串。
 */
function StateChangesEditor({
	value,
	onChange,
	disabled,
	labelPrefix,
	keyPlaceholder = "状态字段，如 spo2",
}: StateChangesProps) {
	const [newKey, setNewKey] = useState("");
	const [newRaw, setNewRaw] = useState("");
	const entries = Object.entries(value);

	const write = (raw: string) => {
		const parsed = parseScalar(raw);
		return parsed === undefined ? "" : parsed;
	};

	const commit = () => {
		const k = newKey.trim();
		if (!k || k in value) return;
		onChange({ ...value, [k]: write(newRaw) });
		setNewKey("");
		setNewRaw("");
	};

	return (
		<Stack gap={8}>
			{entries.map(([k, v]) => (
				<Group key={k} gap={8} align="flex-start" wrap="nowrap">
					<TextInput value={k} disabled placeholder="键" style={{ flex: 1 }} aria-label={`${labelPrefix} 键 ${k}`} />
					<TextInput
						value={textOf(v)}
						onChange={(e) => onChange({ ...value, [k]: write(e.currentTarget.value) })}
						disabled={disabled}
						placeholder="目标值，如 84"
						style={{ flex: 1 }}
						aria-label={`${labelPrefix} ${k} 目标值`}
					/>
					<ActionIcon
						variant="subtle"
						color="gray"
						disabled={disabled}
						aria-label={`${labelPrefix} 删除 ${k}`}
						onClick={() => {
							const next = { ...value };
							delete next[k];
							onChange(next);
						}}
					>
						<IconTrash size={14} />
					</ActionIcon>
				</Group>
			))}
			{entries.length === 0 && <Text size="xs" c="dimmed">还没有内容：至少写一条。</Text>}
			<Group gap={8} wrap="nowrap" align="flex-start">
				<TextInput
					value={newKey}
					onChange={(e) => setNewKey(e.currentTarget.value)}
					placeholder={keyPlaceholder}
					style={{ flex: 1 }}
					disabled={disabled}
					aria-label={`${labelPrefix} 新增键`}
				/>
				<TextInput
					value={newRaw}
					onChange={(e) => setNewRaw(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						}
					}}
					placeholder="目标值，如 84"
					style={{ flex: 1 }}
					disabled={disabled}
					aria-label={`${labelPrefix} 新增目标值`}
				/>
				<ActionIcon variant="light" color="blue" onClick={commit} disabled={disabled} aria-label={`${labelPrefix} 添加`}>
					<IconPlus size={14} />
				</ActionIcon>
			</Group>
		</Stack>
	);
}

// ── 主组件 ────────────────────────────────────────────────────────────────

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export default function ClinicalReasoningEditor({ state, dispatch, disabled }: Props) {
	const scenario = objField(state, "scenario");
	const findings = rowsOf(arrayField(state, "findings"));
	const initial = objField(state, "initial");
	const progression = rowsOf(arrayField(state, "progression"));
	const anchors = rowsOf(arrayField(state, "rubric.anchors"));

	const findingOptions = idOptions(findings);
	const objectiveOptions = OBJECTIVE_GROUPS.flatMap((group) =>
		idOptions(rowsOf(arrayField(state, `objectives.${group.key}`))).map((opt) => ({
			value: opt.value,
			label: `${group.label} · ${opt.label}`,
		})),
	);

	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	function updateFinding(i: number, patch: Record<string, CaseJsonValue | undefined>) {
		set("findings", patchRow(findings, i, patch));
	}

	function updateProgression(i: number, patch: Record<string, CaseJsonValue | undefined>) {
		set("progression", patchRow(progression, i, patch));
	}

	function updateObjective(group: string, i: number, patch: Record<string, CaseJsonValue | undefined>) {
		set(`objectives.${group}`, patchRow(rowsOf(arrayField(state, `objectives.${group}`)), i, patch));
	}

	function updateAnchor(i: number, patch: Record<string, CaseJsonValue | undefined>) {
		set("rubric.anchors", patchRow(anchors, i, patch));
	}

	function addObjective(group: string) {
		const skeleton: Record<string, CaseJsonValue> = { id: "", label: "" };
		if (group === "must_notice") skeleton.finding = "";
		if (group === "must_act") {
			skeleton.action = "";
			skeleton.requires_findings = [];
		}
		if (group === "must_communicate") skeleton.cue = "";
		set(`objectives.${group}`, [...rowsOf(arrayField(state, `objectives.${group}`)), skeleton]);
	}

	function removeObjective(group: string, i: number) {
		set(`objectives.${group}`, rowsOf(arrayField(state, `objectives.${group}`)).filter((_, j) => j !== i));
	}

	const triggerKindOf = (row: Record<string, CaseJsonValue>) =>
		isObj(row.trigger) ? str(row.trigger, "kind") || "time" : "time";

	return (
		<Stack gap="md">
			<CaseBasicsSection state={state} dispatch={dispatch} disabled={disabled} />

			<Tabs defaultValue="scenario" variant="default" keepMounted>
				<Tabs.List>
					<Tabs.Tab value="scenario">场景与患者</Tabs.Tab>
					<Tabs.Tab value="findings">
						<Group gap={6} wrap="nowrap">
							证据目录
							<Badge size="xs" variant="light" color="gray">{findings.length}</Badge>
						</Group>
					</Tabs.Tab>
					<Tabs.Tab value="initial">初始可见性</Tabs.Tab>
					<Tabs.Tab value="progression">
						<Group gap={6} wrap="nowrap">
							病情推进
							<Badge size="xs" variant="light" color="gray">{progression.length}</Badge>
						</Group>
					</Tabs.Tab>
					<Tabs.Tab value="objectives">训练目标</Tabs.Tab>
					<Tabs.Tab value="rubric">
						<Group gap={6} wrap="nowrap">
							评分锚点
							<Badge size="xs" variant="light" color="gray">{anchors.length}</Badge>
						</Group>
					</Tabs.Tab>
				</Tabs.List>

				{/* ── 场景与患者 ── */}
				<Tabs.Panel value="scenario" pt="md">
					<Stack gap="md">
						<Paper withBorder p="md">
							<Text size="sm" fw={600} mb="xs">场景</Text>
							<Stack gap="sm">
								{SCENARIO_FIELDS.map(({ key, label, hint, placeholder, multiline }) => (
									<FieldBlock key={key} label={label} hint={hint}>
										{multiline ? (
											<Textarea
												value={str(scenario, key)}
												onChange={(e) => set(`scenario.${key}`, e.currentTarget.value)}
												placeholder={placeholder}
												autosize
												minRows={2}
												disabled={disabled}
												aria-label={label}
											/>
										) : (
											<TextInput
												value={str(scenario, key)}
												onChange={(e) => set(`scenario.${key}`, e.currentTarget.value)}
												placeholder={placeholder}
												disabled={disabled}
												aria-label={label}
											/>
										)}
									</FieldBlock>
								))}
							</Stack>
						</Paper>
						<PatientSection state={state} dispatch={dispatch} disabled={disabled} />
						<PersonalitySection state={state} dispatch={dispatch} disabled={disabled} />
						<Paper withBorder p="md">
							<Text size="sm" fw={600} mb="xs">病史与背景</Text>
							<Text size="xs" c="dimmed" mb="md">
								V2 上下文使用完整人物背景：患者在对话里能说出的信息在这里声明，学生提问时会按这些内容作答。
							</Text>
							<Stack gap="sm">
								{HISTORY_FIELDS.map(({ key, label, placeholder, multiline }) => (
									<FieldBlock key={key} label={label}>
										{multiline ? (
											<Textarea
												value={stringField(state, key)}
												onChange={(e) => set(key, e.currentTarget.value)}
												placeholder={placeholder}
												autosize
												minRows={2}
												disabled={disabled}
												aria-label={label}
											/>
										) : (
											<TextInput
												value={stringField(state, key)}
												onChange={(e) => set(key, e.currentTarget.value)}
												placeholder={placeholder}
												disabled={disabled}
												aria-label={label}
											/>
										)}
									</FieldBlock>
								))}
								<KeyValueEditor
									title="患者背景与顾虑"
									description="患者本人记得或经历过的事，如家庭顾虑、停药原因；不会主动说，但被问到时应保持一致"
									actionLabel="背景项"
									value={Object.fromEntries(
										Object.entries(objField(state, "deep_background")).map(([k, v]) => [k, textOf(v)]),
									)}
									onChange={(v) => set("deep_background", v)}
									disabled={disabled}
									multiline
								/>
							</Stack>
						</Paper>
					</Stack>
				</Tabs.Panel>

				{/* ── 证据目录 ── */}
				<Tabs.Panel value="findings" pt="md">
					<Stack gap="sm">
						<Text size="xs" c="dimmed">
							证据目录是患者可被获取的全部信息；id 供开场可见性、目标、锚点与推进引用（不含空白，≤64 字）。关键证据必须能获取。
						</Text>
						{findings.length === 0 && (
							<Text size="xs" c="dimmed">还没有证据：先添加一条，再声明它开场可见还是需要主动获取。</Text>
						)}
						{findings.map((f, i) => (
							<Paper key={`finding-${i}`} withBorder p="sm">
								<Stack gap={8}>
									<Group gap={8} align="flex-start">
										<TextInput
											value={str(f, "id")}
											onChange={(e) => updateFinding(i, { id: e.currentTarget.value })}
											placeholder="id，如 f.spo2"
											w={140}
											disabled={disabled}
											aria-label={`证据 ${i + 1} id`}
										/>
										<TextInput
											value={str(f, "label")}
											onChange={(e) => updateFinding(i, { label: e.currentTarget.value })}
											placeholder="证据内容，如 SpO2 88%（未吸氧）"
											style={{ flex: 2, minWidth: 200 }}
											disabled={disabled}
											aria-label={`证据 ${i + 1} 内容`}
										/>
										<Select
											data={FINDING_KIND_OPTIONS}
											value={str(f, "kind") || "vital_sign"}
											onChange={(v) => updateFinding(i, { kind: v ?? "vital_sign" })}
											w={120}
											allowDeselect={false}
											comboboxProps={{ withinPortal: true }}
											disabled={disabled}
											aria-label={`证据 ${i + 1} 种类`}
										/>
										<Checkbox
											checked={f.critical === true}
											onChange={(e) => updateFinding(i, { critical: e.currentTarget.checked })}
											label="关键证据"
											mt={8}
											disabled={disabled}
											aria-label={`证据 ${i + 1} 是否关键证据`}
										/>
										<ActionIcon
											variant="subtle"
											color="gray"
											onClick={() => set("findings", findings.filter((_, j) => j !== i))}
											disabled={disabled}
											aria-label={`删除证据 ${i + 1}`}
											mt={8}
										>
											<IconTrash size={14} />
										</ActionIcon>
									</Group>
									<FieldBlock label="获取途径" hint="如 inquiry:用药顾虑、exam:胸部听诊、lab:CBC；隐藏证据必须声明，inquiry 表示通过患者对话披露">
										<TagsInput
											value={strList(f, "obtainable_via")}
											onChange={(v) => updateFinding(i, { obtainable_via: v })}
											placeholder="输入后回车，如 exam:vital_signs"
											disabled={disabled}
											aria-label={`证据 ${i + 1} 获取途径`}
										/>
									</FieldBlock>
									<FieldBlock label="备注" hint="给作者的说明（不进入学生可见状态）">
										<TextInput
											value={str(f, "note")}
											onChange={(e) => updateFinding(i, { note: e.currentTarget.value })}
											placeholder="可选"
											disabled={disabled}
											aria-label={`证据 ${i + 1} 备注`}
										/>
									</FieldBlock>
								</Stack>
							</Paper>
						))}
						<AddRowButton
							label="证据"
							disabled={disabled}
							onClick={() => set("findings", [...findings, { id: "", label: "", kind: "vital_sign", critical: false, obtainable_via: [] }])}
						/>
					</Stack>
				</Tabs.Panel>

				{/* ── 初始可见性 ── */}
				<Tabs.Panel value="initial" pt="md">
					<Paper withBorder p="md">
						<Text size="sm" fw={600} mb="xs">开场状态</Text>
						<Text size="xs" c="dimmed" mb="md">
							两个清单互斥：开场就看得见的放可见清单，需要学生主动获取的放隐藏清单。每条证据都必须出现在其中之一。
						</Text>
						<Stack gap="md">
							<FieldBlock label="开场可见证据" hint="进入训练立即可读到的证据（如主诉、外观）">
								<MultiSelect
									data={findingOptions}
									value={strList(initial, "visible_findings")}
									onChange={(v) => set("initial.visible_findings", v)}
									searchable
									clearable
									disabled={disabled}
									placeholder={findingOptions.length === 0 ? "先在「证据目录」里添加证据" : "选择证据"}
									aria-label="开场可见证据"
								/>
							</FieldBlock>
							<FieldBlock label="需主动获取的证据" hint="学生做对应操作后才出现；这些证据必须声明获取途径">
								<MultiSelect
									data={findingOptions}
									value={strList(initial, "hidden_findings")}
									onChange={(v) => set("initial.hidden_findings", v)}
									searchable
									clearable
									disabled={disabled}
									placeholder={findingOptions.length === 0 ? "先在「证据目录」里添加证据" : "选择证据"}
									aria-label="需主动获取的证据"
								/>
							</FieldBlock>
						</Stack>
					</Paper>
				</Tabs.Panel>

				{/* ── 病情推进 ── */}
				<Tabs.Panel value="progression" pt="md">
					<Stack gap="sm">
						<Text size="xs" c="dimmed">
							学生不处置时患者如何恶化：触发条件确定性判定（时间 / 证据获取 / 目标达成），状态变化必须非空。
						</Text>
						{progression.length === 0 && (
							<Text size="xs" c="dimmed">还没有推进：若本病例没有恶化或时限压力可以留空（保存时门禁会提示）。</Text>
						)}
						{progression.map((p, i) => {
							const trigger = isObj(p.trigger) ? p.trigger : {};
							const kind = triggerKindOf(p);
							return (
								<Paper key={`progression-${i}`} withBorder p="sm">
									<Stack gap={8}>
										<Group gap={8} align="flex-start">
											<TextInput
												value={str(p, "id")}
												onChange={(e) => updateProgression(i, { id: e.currentTarget.value })}
												placeholder="id，如 p.1"
												w={120}
												disabled={disabled}
												aria-label={`推进 ${i + 1} id`}
											/>
											<Select
												data={TRIGGER_KIND_OPTIONS}
												value={kind}
												onChange={(v) => {
													const next = v ?? "time";
													// 切换触发类型时整份替换 trigger：残留的 ref / after_minutes 会让门禁两义
													updateProgression(i, {
														trigger: next === "time" ? { kind: "time", after_minutes: 5 } : { kind: next, ref: "" },
													});
												}}
												w={130}
												allowDeselect={false}
												disabled={disabled}
												aria-label={`推进 ${i + 1} 触发类型`}
											/>
											{kind === "time" ? (
												<NumberInput
													value={numberOrEmpty(trigger.after_minutes)}
													onChange={(v) => {
														const parsed = parseScalar(String(v ?? ""));
														updateProgression(i, {
															trigger:
																typeof parsed === "number"
																	? { kind: "time", after_minutes: parsed }
																	: { kind: "time" },
														});
													}}
													min={1}
													w={140}
													suffix=" 分钟"
													disabled={disabled}
													aria-label={`推进 ${i + 1} 触发分钟数`}
												/>
											) : (
												<Select
													data={kind === "finding" ? findingOptions : objectiveOptions}
													value={str(trigger, "ref") || null}
													onChange={(v) => updateProgression(i, { trigger: { kind, ref: v ?? "" } })}
													placeholder={kind === "finding" ? "选择证据" : "选择目标"}
													searchable
													clearable
													style={{ flex: 1, minWidth: 200 }}
													disabled={disabled}
													aria-label={`推进 ${i + 1} 触发引用`}
												/>
											)}
											<ActionIcon
												variant="subtle"
												color="gray"
												onClick={() => set("progression", progression.filter((_, j) => j !== i))}
												disabled={disabled}
												aria-label={`删除推进 ${i + 1}`}
												mt={4}
											>
												<IconTrash size={14} />
											</ActionIcon>
										</Group>
										<FieldBlock label="状态变化" hint="键 = 状态字段（如 spo2），值 = 目标值；纯数字写成数字，其余按字符串">
											<StateChangesEditor
												value={isObj(p.state_changes) ? p.state_changes : {}}
												onChange={(v) => updateProgression(i, { state_changes: v })}
												disabled={disabled}
												labelPrefix={`推进 ${i + 1}`}
											/>
										</FieldBlock>
										<FieldBlock label="说明">
											<TextInput
												value={str(p, "description")}
												onChange={(e) => updateProgression(i, { description: e.currentTarget.value })}
												placeholder="如：未吸氧 → 低氧加重"
												disabled={disabled}
												aria-label={`推进 ${i + 1} 说明`}
											/>
										</FieldBlock>
									</Stack>
								</Paper>
							);
						})}
						<AddRowButton
							label="推进"
							disabled={disabled}
							onClick={() => set("progression", [...progression, { id: "", trigger: { kind: "time", after_minutes: 5 }, state_changes: {} }])}
						/>
					</Stack>
				</Tabs.Panel>

				{/* ── 训练目标 ── */}
				<Tabs.Panel value="objectives" pt="md">
					<Stack gap="md">
						<Text size="xs" c="dimmed">
							三类目标都要有：目标 id 供 rubric 锚点引用，新增目标后锚点下拉立即出现它。
						</Text>
						{OBJECTIVE_GROUPS.map((group) => {
							const rows = rowsOf(arrayField(state, `objectives.${group.key}`));
							return (
								<Paper key={group.key} withBorder p="md">
									<Group justify="space-between" align="flex-start" mb="xs">
										<div>
											<Text size="sm" fw={600}>{group.label}</Text>
											<Text size="xs" c="dimmed">{group.hint}</Text>
										</div>
										<Badge size="sm" variant="light" color="gray">{rows.length}</Badge>
									</Group>
									<Stack gap="sm">
										{rows.length === 0 && <Text size="xs" c="dimmed">该组为空：发布门禁会要求至少一条。</Text>}
										{rows.map((row, i) => (
											<Stack key={`${group.key}-${i}`} gap={8}>
												<Group gap={8} align="flex-start">
													<TextInput
														value={str(row, "id")}
														onChange={(e) => updateObjective(group.key, i, { id: e.currentTarget.value })}
														placeholder="id，如 n.1"
														w={110}
														disabled={disabled}
														aria-label={`${group.label} ${i + 1} id`}
													/>
													<TextInput
														value={str(row, "label")}
														onChange={(e) => updateObjective(group.key, i, { label: e.currentTarget.value })}
														placeholder="目标名称"
														style={{ flex: 1, minWidth: 180 }}
														disabled={disabled}
														aria-label={`${group.label} ${i + 1} 名称`}
													/>
													{group.key === "must_notice" && (
														<Select
															data={findingOptions}
															value={str(row, "finding") || null}
															onChange={(v) => updateObjective(group.key, i, { finding: v ?? "" })}
															placeholder="引用证据"
															searchable
															clearable
															style={{ flex: 1, minWidth: 180 }}
															disabled={disabled}
															aria-label={`${group.label} ${i + 1} 引用证据`}
														/>
													)}
													{group.key === "must_act" && (
														<TextInput
															value={str(row, "action")}
															onChange={(e) => updateObjective(group.key, i, { action: e.currentTarget.value })}
															placeholder="动作，如 启动吸氧并复评 SpO2"
															style={{ flex: 1, minWidth: 180 }}
															disabled={disabled}
															aria-label={`${group.label} ${i + 1} 动作`}
														/>
													)}
													{group.key === "must_communicate" && (
														<TextInput
															value={str(row, "cue")}
															onChange={(e) => updateObjective(group.key, i, { cue: e.currentTarget.value })}
															placeholder="必须出现的沟通内容"
															style={{ flex: 1, minWidth: 180 }}
															disabled={disabled}
															aria-label={`${group.label} ${i + 1} 沟通内容`}
														/>
													)}
													<ActionIcon
														variant="subtle"
														color="gray"
														onClick={() => removeObjective(group.key, i)}
														disabled={disabled}
														aria-label={`删除${group.label} ${i + 1}`}
														mt={4}
													>
														<IconTrash size={14} />
													</ActionIcon>
												</Group>
												{group.key === "must_act" && (
													<FieldBlock label="前置证据" hint="学生必须先拿到这些证据才能完成该动作；留空＝无需前置">
														<MultiSelect
															data={findingOptions}
															value={strList(row, "requires_findings")}
															onChange={(v) => updateObjective(group.key, i, { requires_findings: v })}
															searchable
															clearable
															placeholder={findingOptions.length === 0 ? "先在「证据目录」里添加证据" : "选择证据（可空）"}
															disabled={disabled}
															aria-label={`${group.label} ${i + 1} 前置证据`}
														/>
													</FieldBlock>
												)}
											</Stack>
										))}
										<AddRowButton label={group.label} disabled={disabled} onClick={() => addObjective(group.key)} />
									</Stack>
								</Paper>
							);
						})}
					</Stack>
				</Tabs.Panel>

				{/* ── 评分锚点 ── */}
				<Tabs.Panel value="rubric" pt="md">
					<Stack gap="sm">
						<Text size="xs" c="dimmed">
							确定性锚点：规则决定判定方式，权重是相对值（不要求归一）。每个目标至少要有一个锚点引用，否则学生做到也无人判分。
						</Text>
						{anchors.length === 0 && <Text size="xs" c="dimmed">还没有锚点：没有锚点就没有可判分的依据。</Text>}
						{anchors.map((a, i) => {
							const rule = str(a, "rule") || "objective_met";
							return (
								<Paper key={`anchor-${i}`} withBorder p="sm">
									<Stack gap={8}>
										<Group gap={8} align="flex-start">
											<TextInput
												value={str(a, "id")}
												onChange={(e) => updateAnchor(i, { id: e.currentTarget.value })}
												placeholder="id，如 r.1"
												w={110}
												disabled={disabled}
												aria-label={`锚点 ${i + 1} id`}
											/>
											<TextInput
												value={str(a, "label")}
												onChange={(e) => updateAnchor(i, { label: e.currentTarget.value })}
												placeholder="锚点名称"
												style={{ flex: 2, minWidth: 180 }}
												disabled={disabled}
												aria-label={`锚点 ${i + 1} 名称`}
											/>
											<Select
												data={RUBRIC_RULE_OPTIONS}
												value={rule}
												onChange={(v) => updateAnchor(i, { rule: v ?? "objective_met" })}
												w={130}
												allowDeselect={false}
												disabled={disabled}
												aria-label={`锚点 ${i + 1} 判定规则`}
											/>
											<NumberInput
												value={numberOrEmpty(a.weight)}
												onChange={(v) => {
													const parsed = parseScalar(String(v ?? ""));
													updateAnchor(i, { weight: typeof parsed === "number" ? parsed : "" });
												}}
												min={0.1}
												step={0.5}
												decimalScale={2}
												w={100}
												disabled={disabled}
												aria-label={`锚点 ${i + 1} 权重`}
											/>
											<ActionIcon
												variant="subtle"
												color="gray"
												onClick={() => set("rubric.anchors", anchors.filter((_, j) => j !== i))}
												disabled={disabled}
												aria-label={`删除锚点 ${i + 1}`}
												mt={4}
											>
												<IconTrash size={14} />
											</ActionIcon>
										</Group>
										<Group gap={12} align="flex-start">
											<div style={{ flex: 1, minWidth: 240 }}>
												<FieldBlock
													label="引用目标"
													hint={rule === "finding_observed" ? "finding_observed 只判证据，目标可留空" : "目标达成 / 行动 / 沟通类规则必须引用"}
												>
													<MultiSelect
														data={objectiveOptions}
														value={strList(a, "objectives")}
														onChange={(v) => updateAnchor(i, { objectives: v })}
														searchable
														clearable
														placeholder={objectiveOptions.length === 0 ? "先在「训练目标」里添加目标" : "选择目标"}
														disabled={disabled}
														aria-label={`锚点 ${i + 1} 引用目标`}
													/>
												</FieldBlock>
											</div>
											<div style={{ flex: 1, minWidth: 240 }}>
												<FieldBlock
													label="引用证据"
													hint={rule === "finding_observed" ? "finding_observed 必须引用证据" : "可选"}
												>
													<MultiSelect
														data={findingOptions}
														value={strList(a, "findings")}
														onChange={(v) => updateAnchor(i, { findings: v })}
														searchable
														clearable
														placeholder={findingOptions.length === 0 ? "先在「证据目录」里添加证据" : "选择证据（可空）"}
														disabled={disabled}
														aria-label={`锚点 ${i + 1} 引用证据`}
													/>
												</FieldBlock>
											</div>
										</Group>
									</Stack>
								</Paper>
							);
						})}
						<AddRowButton
							label="锚点"
							disabled={disabled}
							onClick={() =>
								set("rubric.anchors", [
									...anchors,
									{ id: "", label: "", rule: "objective_met", weight: 1, objectives: [], findings: [] },
								])
							}
						/>
					</Stack>
				</Tabs.Panel>
			</Tabs>
		</Stack>
	);
}
