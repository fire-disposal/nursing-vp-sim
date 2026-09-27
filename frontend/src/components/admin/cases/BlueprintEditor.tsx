/**
 * 教学蓝图（docs/19 §3.2）作者面。
 *
 * 契约归属：键名 / 枚举 / 默认值以 ``backend/schemas/case_schema.py`` 的 ``CaseBlueprint`` 为唯一
 * owner；形状由保存路径的 pydantic 校验与发布门禁（``modules/cases/validator.py::_check_blueprint``）
 * 逐条报出，这里只负责写入与展示（与 ``CapabilitiesEditor`` 同策，不重复实现第二套校验）。
 *
 * **不注入默认值**：``case_data.blueprint`` 缺失时本组件一个字节都不写 —— 打开病例再保存，
 * 载荷与打开时逐字节一致；只有作者显式勾选「维护教学蓝图」才写入骨架，取消勾选会删除整个键。
 *
 * 蓝图只属于问诊病例（``workflow`` 未声明或 = ``history_taking``）：临床判断病例有自己的声明面，
 * 蓝图放进去不会被任何消费端读取，门禁会直接报错 —— 这里先于门禁给出说明，不做「能填但保存必失败」的表单。
 */

import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";
import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	Checkbox,
	Group,
	Paper,
	Select,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Textarea,
} from "@mantine/core";
import type { CaseDispatch, CaseEditorState, CaseJsonValue } from "./CaseEditorState";
import { StringListEditor } from "./StringListEditor";

/** 与后端注册表一致的 workflow id（`modules/training/profile.py::HISTORY_TAKING`）——蓝图的宿主工作区。 */
export const HISTORY_TAKING_WORKFLOW_ID = "history_taking";

/** 线索来源枚举，与后端 `BlueprintClueSource` 一一对应（顺序同 schema 注释）。 */
const CLUE_SOURCE_OPTIONS: { value: string; label: string }[] = [
	{ value: "initial", label: "开场可得" },
	{ value: "inquiry", label: "追问可得" },
	{ value: "exam", label: "查体可得" },
	{ value: "record", label: "病历可得" },
];

/** 家族内角色，与后端 `BlueprintVariantRole` 一致；空串 = 未声明（写 null，后端枚举不接受 ""）。 */
const VARIANT_ROLE_OPTIONS: { value: string; label: string }[] = [
	{ value: "practice", label: "练习病例" },
	{ value: "transfer", label: "迁移变式" },
];

/** 审阅状态，与后端 `BlueprintEditorialState` 一致。 */
const EDITORIAL_STATE_OPTIONS: { value: string; label: string }[] = [
	{ value: "draft", label: "起草（未经教师审阅）" },
	{ value: "teacher_reviewed", label: "教师已审阅" },
];

/** 引用型与文本型清单的展示元数据（标签 + 提示）；学习目标在顶部单独渲染，顺序即表单顺序。 */
const LIST_FIELDS: { key: string; label: string; hint?: string; placeholder: string }[] = [
	{ key: "must_cover", label: "必须覆盖项", hint: "缺失即判遗漏；每一项须是线索 id 或 required_inquiries 的原文", placeholder: "线索 id 或必询项原文" },
	{ key: "situational", label: "情境相关项", hint: "出现则评、不出现不算遗漏", placeholder: "线索 id 或必询项原文" },
	{ key: "key_omissions", label: "关键遗漏项", hint: "缺失必须独立呈现，不被其他维度补偿掩盖", placeholder: "线索 id 或必询项原文" },
	{ key: "acceptable_evidence", label: "可接受的证据整合", hint: "一行一条合理路径，不是唯一话术", placeholder: "一条可接受的整合路径" },
	{ key: "typical_errors", label: "典型错误", hint: "一行一条；用于判例与反馈，不直接当扣分项", placeholder: "一条典型错误" },
	{
		key: "not_applicable_items",
		label: "不适用评分项",
		hint: "填基准 rubric 的条目 id（dimensions[].items[].id）；由病例预先声明，评分时不再缩小分母",
		placeholder: "rubric 条目 id，如 vital_signs.assess",
	},
];

/** 蓝图骨架：键与 `CaseBlueprint` 一一对应，值全空 —— 内容由作者填写，代码不编造临床内容。 */
export function createEmptyBlueprint(): Record<string, CaseJsonValue> {
	return {
		learning_objectives: [],
		prerequisites: "",
		clues: [],
		must_cover: [],
		situational: [],
		key_omissions: [],
		acceptable_evidence: [],
		typical_errors: [],
		not_applicable_items: [],
		intervention_observable: false,
		family_id: "",
		// 未声明角色：后端 `BlueprintVariantRole | None`，写 "" 会在保存时 422
		variant_role: null,
		transfer_of: "",
		review: { editorial_state: "draft", reviewer: "", reviewed_at: "", note: "" },
	};
}

/** 工作副本里的蓝图；缺失或形状非法（手写 JSON）时返回 null（形状问题由门禁报出）。 */
export function blueprintOf(json: Record<string, CaseJsonValue>): Record<string, CaseJsonValue> | null {
	const raw = json.blueprint;
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
	return raw as Record<string, CaseJsonValue>;
}

function strList(bp: Record<string, CaseJsonValue>, key: string): string[] {
	const raw = bp[key];
	return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

function str(bp: Record<string, CaseJsonValue>, key: string): string {
	const raw = bp[key];
	return typeof raw === "string" ? raw : "";
}

function clueRows(bp: Record<string, CaseJsonValue>): Record<string, CaseJsonValue>[] {
	const raw = bp.clues;
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(c): c is Record<string, CaseJsonValue> => c != null && typeof c === "object" && !Array.isArray(c),
	);
}

function FieldBlock({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div>
			<Text size="xs" fw={600} c="dimmed" mb={4}>{label}</Text>
			{hint && <Text size="xs" c="dimmed" opacity={0.6} mb={4}>{hint}</Text>}
			{children}
		</div>
	);
}

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export default function BlueprintEditor({ state, dispatch, disabled }: Props) {
	const blueprint = blueprintOf(state.json);
	const enabled = blueprint !== null;
	const declaredWorkflow = typeof state.json.workflow === "string" ? state.json.workflow.trim() : "";
	const hosted = declaredWorkflow === "" || declaredWorkflow === HISTORY_TAKING_WORKFLOW_ID;

	/** 逐字段写入：dispatch 只在作者真正编辑时发生 —— 未触碰就不产生 blueprint 键。 */
	function setField(key: string, value: CaseJsonValue) {
		dispatch({ type: "SET_FIELD", path: `blueprint.${key}`, value });
	}

	/** 整份启用 / 移除。移除用 SET_JSON 删键：`undefined` 会留在工作副本里，删键才是真缺席。 */
	function setEnabled(on: boolean) {
		if (on) {
			dispatch({ type: "SET_FIELD", path: "blueprint", value: createEmptyBlueprint() });
			return;
		}
		const next = { ...state.json };
		delete next.blueprint;
		dispatch({ type: "SET_JSON", json: next });
	}

	const clues = blueprint ? clueRows(blueprint) : [];
	const updateClue = (index: number, patch: Record<string, CaseJsonValue>) => {
		setField("clues", clues.map((c, i) => (i === index ? { ...c, ...patch } : c)));
	};

	const review = blueprint && typeof blueprint.review === "object" && !Array.isArray(blueprint.review)
		? (blueprint.review as Record<string, CaseJsonValue>)
		: {};
	const setReview = (key: string, value: CaseJsonValue) => {
		setField("review", { ...review, [key]: value });
	};

	return (
		<Paper withBorder p="md">
			<Group justify="space-between" align="flex-start" gap="xs" wrap="wrap">
				<div>
					<Text size="sm" fw={600}>教学蓝图</Text>
					<Text size="xs" c="dimmed">
						声明本病例能评什么、关键线索与获取途径、覆盖/遗漏边界与家族关系（docs/19 §3.2）。留空即不声明。
					</Text>
				</div>
				<Badge variant="light" color={enabled ? "brand" : "gray"} size="sm">
					{enabled ? "已声明" : "未声明"}
				</Badge>
			</Group>

			{!hosted ? (
				<Alert variant="light" color="orange" mt="md">
					<Text size="xs">
						当前病例声明了 workflow=<Text component="span" fw={600}>{declaredWorkflow}</Text>：教学蓝图只属于问诊病例
						（{HISTORY_TAKING_WORKFLOW_ID}），此处不提供编辑入口 —— 蓝图放进该工作区不会被任何消费端读取，发布门禁会直接报错。
						请在 JSON 视图改为 workflow: "{HISTORY_TAKING_WORKFLOW_ID}"，或删除 blueprint 键。
					</Text>
				</Alert>
			) : (
				<>
					<Checkbox.Card
						checked={enabled}
						onClick={() => setEnabled(!enabled)}
						disabled={disabled}
						radius="md"
						mt="md"
					>
						<Group wrap="nowrap" align="flex-start" gap={8}>
							<Checkbox.Indicator />
							<div>
								<Text size="xs" fw={500}>维护教学蓝图</Text>
								<Text size="xs" c="dimmed" lh={1.2}>
									勾选即写入 blueprint 骨架（全空，待你填写；保存时门禁会逐条点名缺什么）；
									取消勾选会删除整份蓝图，下次保存后生效。
								</Text>
							</div>
						</Group>
					</Checkbox.Card>

					{enabled && blueprint && (
						<Stack gap="md" mt="md">
							<FieldBlock label="学习目标" hint="本次训练能评什么，一行一条；不能评什么写进前置能力">
								<StringListEditor
									value={strList(blueprint, "learning_objectives")}
									onChange={(v) => setField("learning_objectives", v)}
									placeholder="输入后回车添加"
									disabled={disabled}
									removeAriaLabel="移除学习目标"
									addAriaLabel="添加学习目标"
									inputAriaLabel="学习目标条目"
								/>
							</FieldBlock>

							<FieldBlock label="前置能力" hint="学生进入本病例前应已具备的能力（本病例不评）">
								<Textarea
									value={str(blueprint, "prerequisites")}
									onChange={(e) => setField("prerequisites", e.currentTarget.value)}
									placeholder="如：能完成基本问诊并识别生命体征异常"
									autosize
									minRows={2}
									disabled={disabled}
								/>
							</FieldBlock>

							<FieldBlock label="关键线索" hint="id 供覆盖/遗漏清单引用；意义写「为什么它对评估有意义」，不是问句">
								<Stack gap={8}>
									{clues.length === 0 ? (
										<Text size="xs" c="dimmed">还没有线索：先添加线索，再在下方清单里引用它的 id。</Text>
									) : (
										clues.map((clue, i) => (
											<Group key={`${str(clue, "id")}-${i}`} gap={8} align="flex-start" wrap="wrap">
												<TextInput
													value={str(clue, "id")}
													onChange={(e) => updateClue(i, { id: e.currentTarget.value })}
													placeholder="id，如 c1"
													w={120}
													disabled={disabled}
													aria-label={`线索 ${i + 1} id`}
												/>
												<TextInput
													value={str(clue, "label")}
													onChange={(e) => updateClue(i, { label: e.currentTarget.value })}
													placeholder="线索内容"
													style={{ flex: 2, minWidth: 160 }}
													disabled={disabled}
													aria-label={`线索 ${i + 1} 内容`}
												/>
												<Select
													data={CLUE_SOURCE_OPTIONS}
													value={str(clue, "source") || "inquiry"}
													onChange={(v) => updateClue(i, { source: v ?? "inquiry" })}
													w={110}
													disabled={disabled}
													aria-label={`线索 ${i + 1} 来源`}
												/>
												<TextInput
													value={str(clue, "significance")}
													onChange={(e) => updateClue(i, { significance: e.currentTarget.value })}
													placeholder="评估意义"
													style={{ flex: 3, minWidth: 160 }}
													disabled={disabled}
													aria-label={`线索 ${i + 1} 评估意义`}
												/>
												<ActionIcon
													variant="subtle"
													color="gray"
													onClick={() => setField("clues", clues.filter((_, j) => j !== i))}
													disabled={disabled}
													aria-label={`删除线索 ${i + 1}`}
												>
													<IconTrash size={14} />
												</ActionIcon>
											</Group>
										))
									)}
									{!disabled && (
										<Button
											variant="link"
											size="xs"
											onClick={() => setField("clues", [...clues, { id: "", label: "", source: "inquiry", significance: "" }])}
											leftSection={<IconPlus size={12} />}
											w="fit-content"
										>
											添加线索
										</Button>
									)}
								</Stack>
							</FieldBlock>

							<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
								{LIST_FIELDS.map((f) => (
									<FieldBlock key={f.key} label={f.label} hint={f.hint}>
										<StringListEditor
											value={strList(blueprint, f.key)}
											onChange={(v) => setField(f.key, v)}
											placeholder={f.placeholder}
											disabled={disabled}
											removeAriaLabel={`移除${f.label}`}
											addAriaLabel={`添加${f.label}`}
											inputAriaLabel={`${f.label}条目`}
										/>
									</FieldBlock>
								))}
							</SimpleGrid>

							<Checkbox
								checked={blueprint.intervention_observable === true}
								onChange={(e) => setField("intervention_observable", e.currentTarget.checked)}
								label="本次任务存在可观察的干预效果"
								description="关闭时：评价学生的计划与评价方法，不奖励编造结局，也不因无法观察而扣分"
								disabled={disabled}
							/>

							<Text size="xs" fw={600} c="dimmed">家族与变式</Text>
							<SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
								<FieldBlock label="家族 id" hint="同家族共享训练目标">
									<TextInput
										value={str(blueprint, "family_id")}
										onChange={(e) => setField("family_id", e.currentTarget.value)}
										placeholder="如 family.postop_hypoxia"
										disabled={disabled}
									/>
								</FieldBlock>
								<FieldBlock label="家族内角色" hint="练习病例需声明家族；迁移变式还需指向练习病例">
									<Select
										data={VARIANT_ROLE_OPTIONS}
										value={str(blueprint, "variant_role")}
										onChange={(v) => setField("variant_role", v ?? null)}
										placeholder="未声明"
										clearable
										disabled={disabled}
										aria-label="家族内角色"
									/>
								</FieldBlock>
								<FieldBlock label="迁移来源" hint="迁移变式所迁移的练习病例 Case.name">
									<TextInput
										value={str(blueprint, "transfer_of")}
										onChange={(e) => setField("transfer_of", e.currentTarget.value)}
										placeholder="同家族练习病例名"
										disabled={disabled}
									/>
								</FieldBlock>
							</SimpleGrid>

							<Text size="xs" fw={600} c="dimmed">审阅留痕</Text>
							<SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
								<FieldBlock label="审阅状态" hint="只有护理教师能宣布「教师已审阅」">
									<Select
										data={EDITORIAL_STATE_OPTIONS}
										value={str(review, "editorial_state") || "draft"}
										onChange={(v) => setReview("editorial_state", v ?? "draft")}
										disabled={disabled}
										aria-label="审阅状态"
									/>
								</FieldBlock>
								<FieldBlock label="审阅教师" hint="宣布已审阅时必填（门禁会点名）">
									<TextInput
										value={str(review, "reviewer")}
										onChange={(e) => setReview("reviewer", e.currentTarget.value)}
										placeholder="姓名"
										disabled={disabled}
									/>
								</FieldBlock>
								<FieldBlock label="审阅时间">
									<TextInput
										value={str(review, "reviewed_at")}
										onChange={(e) => setReview("reviewed_at", e.currentTarget.value)}
										placeholder="如 2026-09-27"
										disabled={disabled}
									/>
								</FieldBlock>
							</SimpleGrid>
							<FieldBlock label="审阅备注">
								<Textarea
									value={str(review, "note")}
									onChange={(e) => setReview("note", e.currentTarget.value)}
									placeholder="教师对本病例临床事实与关键项的确认/保留意见"
									autosize
									minRows={2}
									disabled={disabled}
								/>
							</FieldBlock>
						</Stack>
					)}
				</>
			)}
		</Paper>
	);
}
