import { IconCode, IconEye, IconForms, IconHistory, IconRotate, IconSparkles, IconWand } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { safeParse, z } from "zod";
import { generateCase, getCaseDetail, publishReportOf } from "@/api";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorMessage } from "@/utils/error";

import {
	Checkbox, Alert, Badge, Box, Button, Divider, Grid, Group, Loader, Modal, MultiSelect, Paper, SegmentedControl, Stack, Text, Textarea } from "@mantine/core";
import { type CaseJsonValue, getDefaultCaseJson, objField, useCaseEditor } from "./CaseEditorState";
import { CaseStatusBadge } from "./CaseStatusBadge";
import {
	applyAcceptedChanges,
	type AiChange,
	AI_CLINICAL_FIELDS,
	AI_PEDAGOGY_FIELDS,
	ALL_FIELD_LABELS,
	diffCaseData,
	summarizeValue,
} from "./ai/staging";
import CaseValidationReportView from "./CaseValidationReportView";
import { caseStatusLabel } from "./caseStatus";
// 只保留"手写 JSON 时的字段提示"所需的两个名字：模板入口与表单区块已隐藏
import { CLINICAL_REASONING_FIELD_HINTS, CLINICAL_REASONING_WORKFLOW_ID } from "./clinicalReasoningTemplate";
import { FormView } from "./FormView";
import JsonView from "./JsonView";
import { useCaseRevisions, useCreateCase, useUpdateCase } from "./useCaseMutations";

type CaseManageItem = components["schemas"]["CaseManageItem"];
type CaseDetail = components["schemas"]["CaseDetail"];
type CaseValidationReport = components["schemas"]["CaseValidationReport"];

/** 表单只校验元数据（docs/15 §六）：name/difficulty/time_limit 落病例列，不进 case_data。 */
const caseFormSchema = z.object({
	name: z.string().min(1, "病例名称不能为空"),
	time_limit: z.number().int().min(30, "训练时限不得短于 30 分钟").max(180, "训练时限不得超过 180 分钟"),
	difficulty: z.number().int().min(1).max(3),
});

/**
 * 编辑器工作副本 = case_data + 病例列上的元数据。
 * ``case_data`` 出参已不含 name/difficulty/time_limit（写路径读进列后剥离），
 * 缺少它们会既过不了本地表单校验、也过不了后端 CaseDataSchema；这里合并回来，
 * 保存时原样回传，由后端剥离落列。
 */
function mergeDetail(detail: CaseDetail): Record<string, CaseJsonValue> {
	return {
		...((detail.case_data ?? {}) as Record<string, CaseJsonValue>),
		name: detail.name,
		description: detail.description ?? "",
		difficulty: detail.difficulty,
		time_limit: detail.time_limit_minutes,
	};
}

/** 可逐字段 AI 生成的临床字段（field 模式，以当前病例为上下文）。 */
/** 草稿自动保存：按病例 id 隔离（新建用 "new"）。 */
function draftKey(id: number | null): string {
	return `case-draft:${id ?? "new"}`;
}

interface Props {
	open: boolean;
	editingCase: CaseManageItem | null;
	startWithAiPanel?: boolean;
	availableCases: CaseManageItem[];
	onClose: () => void;
	onSaved: () => void;
}

export default function CaseFormModal({ open, editingCase, startWithAiPanel, availableCases, onClose, onSaved }: Props) {
	const { state, dispatch } = useCaseEditor(getDefaultCaseJson());
	const [caseMsg, setCaseMsg] = useState("");
	const [showAiPanel, setShowAiPanel] = useState(false);
	const [aiMode, setAiMode] = useState<"quick" | "reference">("quick");
	const [aiDescription, setAiDescription] = useState("");
	const [aiReferenceCaseIds, setAiReferenceCaseIds] = useState<number[]>([]);
	const [aiReferenceText, setAiReferenceText] = useState("");
	const [aiGenerating, setAiGenerating] = useState(false);
	const [aiError, setAiError] = useState("");
	// 生成结果先进暂存区，由教师逐项确认后再写入编辑态（此前直接整份覆盖，见审计 §7）
	const [pendingAi, setPendingAi] = useState<{ changes: AiChange[] } | null>(null);
	const [acceptedPaths, setAcceptedPaths] = useState<string[]>([]);
	const [aiWorking, setAiWorking] = useState(""); // 当前生成动作文案
	const [showPreview, setShowPreview] = useState(false);
	const [showDraftRestore, setShowDraftRestore] = useState(false);
	const [showRevisions, setShowRevisions] = useState(false);
	/** 已加载病例的列级元数据（status/当前版本）—— 列表行可能过期，以详情为准。 */
	const [detailMeta, setDetailMeta] = useState<{ status: string; revisionNo: number | null } | null>(null);
	/** 保存被发布门禁拒绝时的字段级报告。 */
	const [saveReport, setSaveReport] = useState<CaseValidationReport | null>(null);
	const toast = useToast();
	const { confirm } = useConfirm();

	const createMutation = useCreateCase();
	const updateMutation = useUpdateCase();

	const draft = draftKey(editingCase?.id ?? null);
	const status = detailMeta?.status ?? editingCase?.status ?? "draft";
	const revisionNo = detailMeta ? detailMeta.revisionNo : editingCase?.current_revision_no ?? null;
	const archived = status === "archived";
	const published = status === "published";
	const revisionsQuery = useCaseRevisions(open && showRevisions && editingCase ? editingCase.id : null);

	useEffect(() => {
		if (!open) return;
		const load = editingCase
			? getCaseDetail(editingCase.id).then(({ data }) => {
					setDetailMeta({ status: data.status, revisionNo: data.current_revision_no ?? null });
					return mergeDetail(data);
				})
			: Promise.resolve(getDefaultCaseJson());
		setDetailMeta(null);
		load
			.then((cd) => {
				dispatch({ type: "LOAD_CASE", json: cd });
				// 草稿恢复提示：本地草稿存在且与已加载内容不同
				const saved = localStorage.getItem(draft);
				if (saved && saved !== JSON.stringify(cd)) setShowDraftRestore(true);
			})
			.catch(() => toast.error("加载病例数据失败"));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, editingCase, dispatch, toast.error]);

	// ── 草稿自动保存（800ms 防抖） ──
	useEffect(() => {
		if (!open) return;
		const t = setTimeout(() => {
			if (state.isDirty) localStorage.setItem(draft, JSON.stringify(state.json));
		}, 800);
		return () => clearTimeout(t);
	}, [open, state.json, state.isDirty, draft]);

	// 打开时重置 AI 面板状态
	useEffect(() => {
		if (!open) return;
		setCaseMsg("");
		setShowAiPanel(!!startWithAiPanel);
		setAiDescription("");
		setAiReferenceCaseIds([]);
		setAiReferenceText("");
		setAiError("");
		setAiGenerating(false);
		setAiWorking("");
		setShowPreview(false);
		setShowDraftRestore(false);
		setShowRevisions(false);
		setSaveReport(null);
	}, [open, startWithAiPanel]);

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setCaseMsg("");
		setSaveReport(null);
		const data = state.json;
		const result = safeParse(caseFormSchema, {
			name: data.name,
			time_limit: Number(data.time_limit ?? 30),
			difficulty: Number(data.difficulty ?? 1),
		});
		if (!result.success) {
			setCaseMsg(result.error.issues.map((i) => i.message).join("；"));
			return;
		}
		try {
			if (editingCase) {
				const contentChanged = state.initialJson !== JSON.stringify(state.json);
				await updateMutation.mutateAsync({
					id: editingCase.id,
					data: { case_data: data as Record<string, unknown> },
				});
				toast.success(
					published
						? contentChanged
							? "已保存并产生新版本"
							: "已保存（内容未变化，未产生新版本）"
						: "已保存工作副本",
				);
			} else {
				// 新建 = draft：不向学生开放，发布后由列表的「开放」动作决定可见性。
				await createMutation.mutateAsync({
					case_data: data as Record<string, unknown>,
					is_open: false,
				});
				toast.success("已创建草稿：发布后才能用于作业与训练");
			}
			localStorage.removeItem(draft);
			dispatch({ type: "MARK_CLEAN" });
			onSaved();
			onClose();
		} catch (err: unknown) {
			const report = publishReportOf(err);
			if (report) {
				setSaveReport(report);
				setCaseMsg(published ? "保存被发布门禁拒绝：修复下列问题后重试" : "保存失败");
			} else {
				setCaseMsg(getApiErrorMessage(err, "保存失败"));
			}
		}
	};

	/** AI 操作前快照（可撤销），然后填充。 */
	const fillJson = (json: Record<string, CaseJsonValue>) => {
		dispatch({ type: "PUSH_SNAPSHOT" });
		dispatch({ type: "SET_JSON", json });
	};

	const buildPayload = (extra: Record<string, unknown>) => {
		const payload: Record<string, unknown> = {
			mode: aiMode,
			description: aiDescription || state.json.chief_complaint || state.json.description || "护理病史采集训练病例",
			reference_case_ids: aiMode === "reference" ? aiReferenceCaseIds : undefined,
			reference_text: aiMode === "reference" && aiReferenceText ? aiReferenceText : undefined,
			...extra,
		};
		return payload;
	};

	const generateStage = async (stage: "core" | "derivative", label: string) => {
		setAiError("");
		if (!aiDescription.trim() && stage === "core") {
			setAiError("请输入病例描述");
			return;
		}
		setAiGenerating(true);
		setAiWorking(label);
		try {
			const { data } = await generateCase(
				buildPayload({
					stage,
					current_case_data: stage === "derivative" ? state.json : undefined,
				}) as Parameters<typeof generateCase>[0],
			);
			if (data.case_data) stageGenerated(data.case_data as Record<string, CaseJsonValue>, stage === "core" ? "已生成临床骨架" : "已生成教学细节");
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setAiError(e.response?.data?.detail || "AI 生成失败");
		} finally {
			setAiGenerating(false);
			setAiWorking("");
		}
	};

	const generateField = async (field: string) => {
		setAiError("");
		setAiGenerating(true);
		setAiWorking(`生成「${ALL_FIELD_LABELS[field] ?? field}」`);
		try {
			const { data } = await generateCase(
				buildPayload({
					field,
					current_case_data: state.json,
				}) as Parameters<typeof generateCase>[0],
			);
			const label = ALL_FIELD_LABELS[field] ?? field;
			// 复用 applyAcceptedChanges 构造"只改这一个字段"的候选 JSON，再走统一暂存
			const afterJson = applyAcceptedChanges(
				state.json,
				[{ path: field, label, before: undefined, after: data.field_value }],
				[field],
			);
			stageGenerated(afterJson, `已生成「${label}」建议`);
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setAiError(`生成「${ALL_FIELD_LABELS[field] ?? field}」失败: ${e.response?.data?.detail || "AI 生成失败"}`);
		} finally {
			setAiGenerating(false);
			setAiWorking("");
		}
	};

	/** 生成结果不直接落编辑态：算出差异后进暂存区等待确认。 */
	const stageGenerated = (afterJson: Record<string, CaseJsonValue>, okMsg: string) => {
		const changes = diffCaseData(state.json, afterJson);
		if (changes.length === 0) {
			toast.success(`${okMsg}（与当前内容一致，无需应用）`);
			return;
		}
		setPendingAi({ changes });
		setAcceptedPaths(changes.map((c) => c.path));
		toast.success(`${okMsg}：${changes.length} 项变化待确认`);
	};

	const handleApplyAi = () => {
		if (!pendingAi) return;
		dispatch({ type: "PUSH_SNAPSHOT" });
		dispatch({
			type: "SET_JSON",
			json: applyAcceptedChanges(state.json, pendingAi.changes, acceptedPaths),
		});
		toast.success(`已应用 ${acceptedPaths.length} 项（可用撤销回退）`);
		setPendingAi(null);
	};

	const handleUndo = () => {
		if (state.undoStack.length === 0) return;
		dispatch({ type: "UNDO" });
		toast.success("已撤销上一次 AI 填充");
	};

	const handleRestoreDraft = () => {
		const saved = localStorage.getItem(draft);
		if (!saved) return;
		try {
			const parsed = JSON.parse(saved) as Record<string, CaseJsonValue>;
			fillJson(parsed);
			setShowDraftRestore(false);
			toast.success("已恢复草稿");
		} catch {
			localStorage.removeItem(draft);
			setShowDraftRestore(false);
		}
	};

	const handleClose = async () => {
		if (state.isDirty && JSON.stringify(state.json) !== state.initialJson) {
			const ok = await confirm({ title: "关闭病例编辑", message: "内容未保存，确定关闭？" });
			if (!ok) return;
		}
		onClose();
	};

	const preview = useMemo(() => {
		const pi = (state.json.patient_info ?? {}) as Record<string, CaseJsonValue>;
		const inquiries = (state.json.required_inquiries as unknown[]) ?? [];
		const hidden = (state.json.hidden_info as unknown[]) ?? [];
		return {
			patient: `${String(pi.name ?? "")} ${pi.age ?? ""}岁 ${String(pi.gender ?? "")}`.trim(),
			chief: String(state.json.chief_complaint ?? ""),
			opening: String(state.json.opening_line ?? ""),
			inquiries: inquiries.length,
			hidden: hidden.length,
		};
	}, [state.json]);

	const aiBusy = aiGenerating;
	// 临床骨架是否已有内容：教学细节生成以骨架为上下文，空骨架产出质量差（2026-09-26 防呆）
	const hasSkeleton = Boolean(
		String(state.json.name ?? "").trim() &&
			(String(state.json.chief_complaint ?? "").trim() || String(state.json.present_illness ?? "").trim()),
	);

	return (
		<Modal
			opened={open}
			onClose={() => { void handleClose(); }}
			title={editingCase ? `编辑病例: ${editingCase.name}` : "添加新病例"}
			size={state.mode === "json" ? 960 : 900}
			centered
			withinPortal
		>
				{editingCase && (
					<Group gap={8} mb="sm" wrap="wrap">
						<CaseStatusBadge status={status} revisionNo={revisionNo} size="sm" />
						<Button
							type="button"
							size="compact-xs"
							variant="subtle"
							color="gray"
							leftSection={<IconHistory size={13} />}
							onClick={() => setShowRevisions(true)}
						>
							版本历史
						</Button>
					</Group>
				)}

				{published && (
					<Alert variant="light" color="blue" mb="md">
						<Text size="sm">
							该病例已发布{revisionNo != null ? `（当前 v${revisionNo}）` : ""}：保存内容变化会立即生效并产生新版本，
							旧训练仍按各自版本复盘；保存前会先过发布门禁，未通过则不会落库。
						</Text>
					</Alert>
				)}
				{archived && (
					<Alert variant="light" color="orange" mb="md">
						<Text size="sm">该病例已归档，内容已冻结、不能再编辑（历史版本与既有训练保留）。</Text>
					</Alert>
				)}

				{caseMsg && (
					<Alert variant="light" color="red" mb="md">
						{caseMsg}
					</Alert>
				)}

				{saveReport && (
					<Paper withBorder p="sm" mb="md">
						<CaseValidationReportView report={saveReport} />
					</Paper>
				)}

				{showDraftRestore && (
					<Alert variant="light" color="yellow" mb="md">
						<Group justify="space-between" gap={8} wrap="wrap">
							<Text size="sm">检测到未保存的草稿</Text>
							<Group gap={8}>
								<Button type="button" size="sm" variant="outline" onClick={handleRestoreDraft}>恢复草稿</Button>
								<Button type="button" size="sm" variant="subtle" color="gray" onClick={() => { localStorage.removeItem(draft); setShowDraftRestore(false); }}>丢弃</Button>
							</Group>
						</Group>
					</Alert>
				)}

				{/* ── Toolbar ── */}
				<Group gap={8} mb="md">
					<Button
						size="xs"
						variant={showAiPanel ? "filled" : "outline"}
						color="brand"
						onClick={() => setShowAiPanel(!showAiPanel)}
						leftSection={<IconWand size={13} />}
					>
						AI
					</Button>

					{state.undoStack.length > 0 && (
						<Button
							size="xs"
							variant="outline"
							color="gray"
							onClick={handleUndo}
							title="撤销上一次 AI 填充"
							leftSection={<IconRotate size={13} />}
						>
							撤销
						</Button>
					)}

					<Button
						size="xs"
						variant={showPreview ? "filled" : "outline"}
						color={showPreview ? "blue" : "gray"}
						onClick={() => setShowPreview(!showPreview)}
						title="病例预览"
						leftSection={<IconEye size={13} />}
					>
						预览
					</Button>

					<SegmentedControl
						size="xs"
						ml="auto"
						value={state.mode}
						onChange={(v) => dispatch({ type: "SWITCH_MODE", mode: v as "form" | "json" })}
						data={[
							{ value: "form", label: <Group gap={4} wrap="nowrap"><IconForms size={13} />表单</Group> },
							{ value: "json", label: <Group gap={4} wrap="nowrap"><IconCode size={13} />JSON</Group> },
						]}
					/>
				</Group>

				{/* ── AI 面板：两步向导 + 逐字段生成 ── */}
				{showAiPanel && (
					<Paper withBorder p="md" mb="md" bg="var(--mantine-color-brand-0)" style={{ borderColor: "var(--mantine-color-brand-2)" }} >
						<Group gap={6} wrap="wrap" mb="sm">
							<Text size="xs" fw={600} c="brand">生成向导</Text>
							<Badge variant="light" color={state.json.name || state.json.chief_complaint ? "green" : "gray"} size="xs">1 临床骨架</Badge>
							<Text size="xs" c="dimmed" opacity={0.4}>→</Text>
							<Badge variant="light" color={(state.json.required_inquiries as unknown[])?.length || Object.keys(objField(state, "activities.physical_exam.config")).length > 0 ? "green" : "gray"} size="xs">2 教学细节</Badge>
						</Group>

						<SegmentedControl
							size="xs"
							color="brand"
							mb="sm"
							value={aiMode}
							onChange={(v) => setAiMode(v as "quick" | "reference")}
							data={[
								{ value: "quick", label: "快速生成" },
								{ value: "reference", label: "参考模板" },
							]}
						/>

						<Textarea
							value={aiDescription}
							onChange={(e) => setAiDescription(e.currentTarget.value)}
							placeholder="描述你想生成的病例场景（年龄、主诉、病情特点…）"
							autosize
							minRows={3}
							mb="xs"
						/>

						{aiMode === "reference" && (
							<Stack gap={8} mb="xs">
								<Text size="xs" c="dimmed">参考病例</Text>
								<MultiSelect
									data={availableCases.map((c) => ({ value: String(c.id), label: `${c.name}（${caseStatusLabel(c.status)}）` }))}
									value={aiReferenceCaseIds.map(String)}
									onChange={(v) => setAiReferenceCaseIds(v.map(Number))}
									searchable
									placeholder="选择参考病例"
								/>
								<Textarea
									value={aiReferenceText}
									onChange={(e) => setAiReferenceText(e.currentTarget.value)}
									placeholder="或直接粘贴参考文本..."
									autosize
									minRows={2}
								/>
							</Stack>
						)}

						{aiError && <Text size="xs" c="red" mb="xs">{aiError}</Text>}

						{/* 两步按钮 */}
						<Group gap={8} wrap="wrap">
							<Button size="sm" onClick={() => generateStage("core", "生成临床骨架")} disabled={aiBusy} leftSection={<IconSparkles size={14} />}>
								{aiBusy && aiWorking === "生成临床骨架" ? "生成中…" : "生成临床骨架"}
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => generateStage("derivative", "生成教学细节")}
								disabled={aiBusy || !hasSkeleton}
								title={hasSkeleton ? undefined : "请先生成或填写临床骨架（名称/主诉/现病史）——教学细节以骨架为上下文"}
								leftSection={<IconSparkles size={14} />}
							>
								{aiBusy && aiWorking === "生成教学细节" ? "生成中…" : "生成教学细节"}
							</Button>
						</Group>

						{/* 逐字段生成（分组） */}
						<Stack gap={8} mt="md" pt="md" style={{ borderTop: "1px solid var(--mantine-color-brand-2)" }}>
							<Text size="xs" c="dimmed">逐字段完善（以当前编辑内容为上下文，可反复生成）</Text>
							<Group gap={6} wrap="wrap">
								<Text size="xs" c="brand" style={{ flexShrink: 0, width: 56 }}>临床字段</Text>
								{AI_CLINICAL_FIELDS.map((f) => (
									<Button key={f.key} size="xs" variant="light" color="brand" onClick={() => generateField(f.key)} disabled={aiBusy}>
										{f.label}
									</Button>
								))}
							</Group>
							<Group gap={6} wrap="wrap">
								<Text size="xs" c="brand" style={{ flexShrink: 0, width: 56 }}>教学字段</Text>
								{AI_PEDAGOGY_FIELDS.map((f) => (
									<Button key={f.key} size="xs" variant="light" color="brand" onClick={() => generateField(f.key)} disabled={aiBusy}>
										{f.label}
									</Button>
								))}
							</Group>
						</Stack>

						{pendingAi && (
							<Stack gap="xs" mt="md" pt="md" style={{ borderTop: "1px solid var(--mantine-color-brand-2)" }}>
								<Group justify="space-between" align="center" wrap="wrap" gap="xs">
									<Group gap={8} align="center">
										<Badge variant="light" color="brand" size="sm">
											{pendingAi.changes.length} 项待确认
										</Badge>
										<Text size="xs" c="dimmed">勾选要采纳的字段；未勾选的保持你当前的内容</Text>
									</Group>
									<Group gap={6}>
										<Button size="compact-xs" variant="subtle" onClick={() => setAcceptedPaths(pendingAi.changes.map((c) => c.path))}>
											全选
										</Button>
										<Button size="compact-xs" variant="subtle" onClick={() => setAcceptedPaths([])}>
											全不选
										</Button>
										<Button size="compact-xs" variant="light" color="gray" onClick={() => setPendingAi(null)}>
											丢弃
										</Button>
										<Button size="compact-xs" onClick={handleApplyAi} disabled={acceptedPaths.length === 0}>
											应用选中（{acceptedPaths.length}）
										</Button>
									</Group>
								</Group>
								<Stack gap={6}>
									{pendingAi.changes.map((c) => (
										<Group key={c.path} gap={8} align="flex-start" wrap="nowrap">
											<Checkbox
												size="xs"
												checked={acceptedPaths.includes(c.path)}
												onChange={(e) =>
													setAcceptedPaths(
														e.currentTarget.checked
															? [...acceptedPaths, c.path]
															: acceptedPaths.filter((path) => path !== c.path),
													)
												}
												aria-label={`采纳${c.label}`}
											/>
											<Box style={{ flex: 1, minWidth: 0 }}>
												<Text size="xs" fw={600}>{c.label}</Text>
												<Text size="xs" c="dimmed" style={{ wordBreak: "break-word" }}>
													当前：{summarizeValue(c.before, 48)}
												</Text>
												<Text size="xs" style={{ wordBreak: "break-word" }}>
													生成：{summarizeValue(c.after, 96)}
												</Text>
											</Box>
										</Group>
									))}
								</Stack>
							</Stack>
						)}
					</Paper>
				)}

				{/* ── 病例预览（只读学生视角） ── */}
				{showPreview && (
					<Paper withBorder p="md" mb="md">
						<Text size="xs" fw={600} mb="xs">病例预览</Text>
						<Grid gap="xs">
							<Grid.Col span={{ base: 12, sm: 6 }}><Text size="xs"><Text component="span" c="dimmed">名称：</Text>{String(state.json.name ?? "") || "—"}</Text></Grid.Col>
							<Grid.Col span={{ base: 12, sm: 6 }}><Text size="xs"><Text component="span" c="dimmed">患者：</Text>{preview.patient || "—"}</Text></Grid.Col>
							<Grid.Col span={12}><Text size="xs"><Text component="span" c="dimmed">主诉：</Text>{preview.chief || "—"}</Text></Grid.Col>
							<Grid.Col span={12}><Text size="xs"><Text component="span" c="dimmed">开场白：</Text>{preview.opening || "—"}</Text></Grid.Col>
							<Grid.Col span={{ base: 12, sm: 6 }}><Text size="xs"><Text component="span" c="dimmed">必询要点：</Text>{preview.inquiries} 条</Text></Grid.Col>
							<Grid.Col span={{ base: 12, sm: 6 }}><Text size="xs"><Text component="span" c="dimmed">隐藏信息：</Text>{preview.hidden} 条</Text></Grid.Col>
						</Grid>
					</Paper>
				)}

				{/* ── Editor area ── */}
				<form onSubmit={handleSave}>
					<Stack gap="md">
						{state.mode === "json" && state.json.workflow === CLINICAL_REASONING_WORKFLOW_ID && (
							<Alert variant="light" color="teal" title="临床判断训练病例：JSON 里需要哪些字段">
								<Stack gap={4}>
									{CLINICAL_REASONING_FIELD_HINTS.map((hint) => (
										<Text key={hint.path} size="xs">
											<Text component="span" fw={600} style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
												{hint.path}
											</Text>
											{`（${hint.label}）：${hint.requirement}`}
										</Text>
									))}
									<Text size="xs" c="dimmed" mt={4}>
										保存与发布都会跑服务端门禁，错误按 JSON 路径列在上方；本页不重复实现一套校验。
									</Text>
								</Stack>
							</Alert>
						)}
						{state.mode === "json" ? (
							<JsonView json={state.json} dispatch={dispatch} readOnly={archived} />
						) : (
							<FormView state={state} dispatch={dispatch} disabled={archived} />
						)}

						<Group
							justify="flex-end"
							gap={8}
							pt="sm"
							style={{ position: "sticky", bottom: 0, background: "var(--mantine-color-body)", borderTop: "1px solid var(--mantine-color-gray-3)" }}
						>
							<Button type="button" variant="outline" size="sm" onClick={handleClose}>取消</Button>
							<Button
								type="submit"
								size="sm"
								disabled={archived || createMutation.isPending || updateMutation.isPending}
								title={archived ? "已归档病例内容冻结，不可保存" : undefined}
							>
								{editingCase
									? updateMutation.isPending
										? "保存中…"
										: published
											? "保存为新版本"
											: "保存"
									: createMutation.isPending
										? "创建中…"
										: "创建草稿"}
							</Button>
						</Group>
					</Stack>
				</form>

				{/* ── 版本历史（已发布病例的内容快照） ── */}
				<Modal
					opened={showRevisions}
					onClose={() => setShowRevisions(false)}
					title="版本历史"
					size="md"
					centered
					withinPortal
				>
					<Stack gap="xs">
						<Text size="xs" c="dimmed">
							已发布版本不可修改；编辑已发布病例会追加新版本，旧训练仍按各自版本复盘。
						</Text>
						{revisionsQuery.isLoading ? (
							<Group gap={8} py="sm">
								<Loader size={14} />
								<Text size="sm" c="dimmed">加载中…</Text>
							</Group>
						) : revisionsQuery.isError ? (
							<Text size="sm" c="red">版本历史加载失败</Text>
						) : (revisionsQuery.data?.length ?? 0) === 0 ? (
							<Text size="sm" c="dimmed">该病例还没有已发布版本（发布后才会产生 v1）。</Text>
						) : (
							<Stack gap={0}>
								{revisionsQuery.data?.map((r) => (
									<Box key={r.id}>
										<Group justify="space-between" gap={8} wrap="nowrap" py={6}>
											<Group gap={6} wrap="nowrap">
												<Badge variant={r.is_current ? "filled" : "light"} color={r.is_current ? "green" : "gray"} size="xs">
													v{r.revision_no}
												</Badge>
												{r.is_current && <Text size="xs" c="dimmed">当前版本</Text>}
											</Group>
											<Text size="xs" c="dimmed">
												{r.published_at
													? `发布 ${new Date(r.published_at).toLocaleString()}`
													: `创建 ${new Date(r.created_at).toLocaleString()}`}
											</Text>
										</Group>
										<Divider />
									</Box>
								))}
							</Stack>
						)}
					</Stack>
				</Modal>
		</Modal>
	);
}
