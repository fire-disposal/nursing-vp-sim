import { formatDateTime } from "@/utils/date";
import {
	IconArchive,
	IconChevronLeft,
	IconCode,
	IconEye,
	IconForms,
	IconHistory,
	IconRocket,
	IconRotate,
	IconSparkles,
	IconWand,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { safeParse, z } from "zod";
import { generateCase, getCaseDetail, getCaseValidation, getManageCases, publishReportOf } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { getApiErrorMessage } from "@/utils/error";

import {
	Stepper,
	Alert, Anchor, Badge, Box, Button, Checkbox, Grid, Group, Loader, MultiSelect,
	Paper, ScrollArea, SegmentedControl, Stack, Table, Text, Textarea, Title } from "@mantine/core";
import { type CaseJsonValue, getDefaultCaseJson, objField, useCaseEditor } from "./CaseEditorState";
import { CaseStatusBadge } from "./CaseStatusBadge";
import {
	applyAcceptedChanges,
	type AiChange,
	AI_CLINICAL_FIELDS,
	AI_PEDAGOGY_FIELDS,
	ALL_FIELD_LABELS,
	diffCaseData,
	getCasePath,
	summarizeValue,
} from "./ai/staging";
import CaseValidationReportView from "./CaseValidationReportView";
import { caseStatusLabel } from "./caseStatus";
// 只保留"手写 JSON 时的字段提示"所需的两个名字：模板入口与表单区块已隐藏
import { CLINICAL_REASONING_FIELD_HINTS, CLINICAL_REASONING_WORKFLOW_ID } from "./clinicalReasoningTemplate";
import { FormView } from "./FormView";
import JsonView from "./JsonView";
import { useCaseRevisions, useCreateCase, usePublishCase, useUpdateCase } from "./useCaseMutations";

type CaseDetail = components["schemas"]["CaseDetail"];
type CaseValidationReport = components["schemas"]["CaseValidationReport"];

/** 表单只校验元数据：name/difficulty/time_limit 落病例列，不进 case_data。 */
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

/**
 * 草稿自动保存键：按病例 id 隔离（新建用 "new"）。
 *
 * 工作台是独立页面，刷新/误关后要能接着改，所以草稿仍是 per-case 的 localStorage 条目；
 * 页面卸载时不丢弃（只有「保存成功」或用户主动丢弃才清）。
 */
function draftKey(id: number | null): string {
	return `case-draft:${id ?? "new"}`;
}

/** 病例库列表路径；工作台的「返回」与保存后跳转都指向它。 */
export const CASES_LIST_PATH = "/admin/cases";

/** 新建病例工作台：`mode=ai` 时打开 AI 面板（病例库的「AI 生成」入口）。 */
export function newCasePath(options?: { ai?: boolean }): string {
	return `${CASES_LIST_PATH}/new${options?.ai ? "?mode=ai" : ""}`;
}

/** 编辑病例工作台（可深链，刷新即回到该病例）。 */
export function editCasePath(caseId: number | string): string {
	return `${CASES_LIST_PATH}/${caseId}`;
}

interface Props {
	/** 病例 id；`null` = 新建。地址栏是唯一来源（工作台页从路由参数解出）。 */
	caseId: number | null;
	/** 新建时是否直接打开 AI 面板（`?mode=ai`）。 */
	startWithAiPanel?: boolean;
}

/**
 * 病例工作台：新建/编辑/AI 生成的唯一编辑界面。
 *
 * 此前它是病例库列表里的 900px 嵌套 Modal（版本历史还叠了第二层 Modal），刷新即丢、
 * 不能深链、移动端被挤成两列。现在搬到独立页面：表单/JSON、AI 两步 + 逐字段差异确认、
 * 草稿恢复、未保存确认、学生视角预览、保存/发布校验、版本历史全在这一页，
 * 版本历史是页内面板而不是第二层 Modal。
 */
export default function CaseFormPage({ caseId, startWithAiPanel = false }: Props) {
	const navigate = useNavigate();
	const { state, dispatch } = useCaseEditor(getDefaultCaseJson());
	const [caseMsg, setCaseMsg] = useState("");
	const [showAiPanel, setShowAiPanel] = useState(!!startWithAiPanel);
	const [aiMode, setAiMode] = useState<"quick" | "reference">("quick");
	const [aiDescription, setAiDescription] = useState("");
	const [aiReferenceCaseIds, setAiReferenceCaseIds] = useState<number[]>([]);
	const [aiReferenceText, setAiReferenceText] = useState("");
	const [aiGenerating, setAiGenerating] = useState(false);
	const [aiError, setAiError] = useState("");
	// 生成结果先进暂存区，由教师逐项确认后再写入编辑态（此前直接整份覆盖，见审计 §7）
	const [pendingAi, setPendingAi] = useState<{ changes: AiChange[] } | null>(null);
	const [acceptedPaths, setAcceptedPaths] = useState<string[]>([]);
	// A3：生成中可取消（AbortController）、显示已用时间与上次生成的耗时/token/修复提示
	const abortRef = useRef<AbortController | null>(null);
	const [aiElapsed, setAiElapsed] = useState(0);
	const [lastMeta, setLastMeta] = useState<{
		elapsedMs: number;
		usage: Record<string, number> | null;
		warnings: string[];
	} | null>(null);
	const [aiWorking, setAiWorking] = useState(""); // 当前生成动作文案
	const [showPreview, setShowPreview] = useState(false);
	const [showDraftRestore, setShowDraftRestore] = useState(false);
	const [showRevisions, setShowRevisions] = useState(false);
	/** 已加载病例的列级元数据（status/当前版本）—— 列表行可能过期，以详情为准。 */
	const [detailMeta, setDetailMeta] = useState<{ status: string; revisionNo: number | null } | null>(null);
	/** 保存被发布门禁拒绝时的字段级报告。 */
	const [saveReport, setSaveReport] = useState<CaseValidationReport | null>(null);
	/** 发布门禁预览：点「发布」先取校验报告，有 error 时只读展示并阻止发布。 */
	const [gateReport, setGateReport] = useState<CaseValidationReport | null>(null);
	const [gateLoading, setGateLoading] = useState(false);
	const [publishing, setPublishing] = useState(false);
	/** 详情加载失败：编辑器里是默认骨架，任何保存都会覆盖真实病例。 */
	const [loadFailed, setLoadFailed] = useState(false);
	/** 已加载过一次（区分"首个渲染"与"切换病例"）。 */
	const [loaded, setLoaded] = useState(false);
	const toast = useToast();
	const { confirm } = useConfirm();

	const createMutation = useCreateCase();
	const updateMutation = useUpdateCase();
	const publishMutation = usePublishCase();

	const draft = draftKey(caseId);
	const status = detailMeta?.status ?? "draft";
	const revisionNo = detailMeta?.revisionNo ?? null;
	const archived = status === "archived";
	const published = status === "published";
	const revisionsQuery = useCaseRevisions(showRevisions ? caseId : null);

	// 详情：走 query keys 上报缓存，返回列表再进来不会闪空；失败不重试（下面有显式重试入口）
	const detailQuery = useQuery({
		queryKey: queryKeys.cases.managed.detail(caseId ?? "new"),
		queryFn: () => getCaseDetail(caseId as number).then((r) => r.data),
		enabled: caseId != null,
		staleTime: 0,
		retry: false,
	});

	/** AI 参考病例下拉：只取第一页（参考模板不是"从 500 条里挑一条"，筛完再选即可）。 */
	const referenceQuery = useQuery({
		queryKey: queryKeys.cases.managed.list({ limit: 100, source: "case-workspace-reference" }),
		queryFn: () => getManageCases({ limit: 100 }).then((r) => r.data),
		enabled: showAiPanel && aiMode === "reference",
		staleTime: 5 * 60_000,
	});
	const availableCases = useMemo(
		() => (referenceQuery.data?.items ?? []).filter((c) => c.id !== caseId),
		[referenceQuery.data, caseId],
	);

	// ── 载入：新建给默认骨架；编辑拉详情 ──
	useEffect(() => {
		// 首次进入就重置面板状态（重新挂载 = 重新进入工作台）
		setShowDraftRestore(false);
		if (caseId == null) {
			const skeleton = getDefaultCaseJson();
			dispatch({ type: "LOAD_CASE", json: skeleton });
			setLoaded(true);
			setDetailMeta(null);
			setLoadFailed(false);
			const saved = localStorage.getItem(draft);
			if (saved && saved !== JSON.stringify(skeleton)) setShowDraftRestore(true);
			return;
		}
		if (!detailQuery.data) return;
		setDetailMeta({
			status: detailQuery.data.status,
			revisionNo: detailQuery.data.current_revision_no ?? null,
		});
		const cd = mergeDetail(detailQuery.data);
		dispatch({ type: "LOAD_CASE", json: cd });
		setLoaded(true);
		const saved = localStorage.getItem(draft);
		if (saved && saved !== JSON.stringify(cd)) setShowDraftRestore(true);
	}, [caseId, detailQuery.data, dispatch, draft]);

	const detailError = detailQuery.isError;
	/** 404 单独说「找不到这个病例」，而不是通用失败文案。 */
	const detailErrorStatus = (detailQuery.error as { response?: { status?: number } } | null)?.response?.status ?? null;
	useEffect(() => {
		if (!detailError) return;
		setLoadFailed(true);
		setLoaded(true);
		toast.error("加载病例数据失败：当前内容不是该病例，已禁用保存，请重试");
	}, [detailError, toast]);

	// ── 草稿自动保存（800ms 防抖） ──
	useEffect(() => {
		if (!loaded) return;
		const t = setTimeout(() => {
			if (state.isDirty) localStorage.setItem(draft, JSON.stringify(state.json));
		}, 800);
		return () => clearTimeout(t);
	}, [loaded, state.json, state.isDirty, draft]);

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		if (loadFailed) {
			setCaseMsg("病例数据加载失败：当前编辑器是默认骨架，修复前不可保存");
			return;
		}
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
			if (caseId != null) {
				const contentChanged = state.initialJson !== JSON.stringify(state.json);
				await updateMutation.mutateAsync({
					id: caseId,
					data: { case_data: data as Record<string, unknown> },
				});
				toast.success(
					published
						? contentChanged
							? "已保存并产生新版本"
							: "已保存（内容未变化，未产生新版本）"
						: "已保存工作副本",
				);
				localStorage.removeItem(draft);
				dispatch({ type: "MARK_CLEAN" });
				// 发布门禁/状态可能变了：重取详情（缓存被 invalidate 后自动重跑）
				return;
			}
			// 新建 = draft：不向学生开放，发布后由列表的「开放」动作决定可见性。
			const { data: created } = await createMutation.mutateAsync({
				case_data: data as Record<string, unknown>,
				is_open: false,
			});
			toast.success("已创建草稿：发布后才能用于作业与训练");
			localStorage.removeItem(draft);
			dispatch({ type: "MARK_CLEAN" });
			// 新建成功后换成该病例的深链：刷新仍是这份病例，版本/发布后续动作落在它上面
			navigate(editCasePath(created.id), { replace: true });
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
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const { data } = await generateCase(
				buildPayload({
					stage,
					current_case_data: stage === "derivative" ? state.json : undefined,
				}) as Parameters<typeof generateCase>[0],
				{ signal: controller.signal },
			);
			setLastMeta({
				elapsedMs: data.elapsed_ms ?? 0,
				usage: (data.usage as Record<string, number> | null) ?? null,
				warnings: data.warnings ?? [],
			});
			if (data.case_data) stageGenerated(data.case_data as Record<string, CaseJsonValue>, stage === "core" ? "已生成临床骨架" : "已生成教学细节");
		} catch (err: unknown) {
			if (isCancelled(err)) return;
			const e = err as { response?: { data?: { detail?: string } } };
			setAiError(e.response?.data?.detail || "AI 生成失败");
		} finally {
			abortRef.current = null;
			setAiGenerating(false);
			setAiWorking("");
		}
	};

	const generateField = async (field: string) => {
		setAiError("");
		setAiGenerating(true);
		setAiWorking(`生成「${ALL_FIELD_LABELS[field] ?? field}」`);
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const { data } = await generateCase(
				buildPayload({
					field,
					current_case_data: state.json,
				}) as Parameters<typeof generateCase>[0],
				{ signal: controller.signal },
			);
			setLastMeta({
				elapsedMs: data.elapsed_ms ?? 0,
				usage: (data.usage as Record<string, number> | null) ?? null,
				warnings: data.warnings ?? [],
			});
			const label = ALL_FIELD_LABELS[field] ?? field;
			// 复用 applyAcceptedChanges 构造"只改这一个字段"的候选 JSON，再走统一暂存
			const afterJson = applyAcceptedChanges(
				state.json,
				[{ path: field, label, before: undefined, after: data.field_value }],
				[field],
			);
			stageGenerated(afterJson, `已生成「${label}」建议`);
		} catch (err: unknown) {
			if (isCancelled(err)) return;
			const e = err as { response?: { data?: { detail?: string } } };
			setAiError(`生成「${ALL_FIELD_LABELS[field] ?? field}」失败: ${e.response?.data?.detail || "AI 生成失败"}`);
		} finally {
			abortRef.current = null;
			setAiGenerating(false);
			setAiWorking("");
		}
	};

	const isCancelled = (err: unknown) => (err as { code?: string } | null)?.code === "ERR_CANCELED";

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

	/** 字段状态：待应用（在差异面板里）> 已填 > 空（A3 的字段状态点）。 */
	const fieldDot = (path: string) => {
		if (pendingAi?.changes.some((c) => c.path === path)) return "var(--mantine-color-orange-6)";
		const value = getCasePath(state.json, path);
		const empty =
			value == null ||
			value === "" ||
			(Array.isArray(value) && value.length === 0) ||
			(typeof value === "object" && Object.keys(value as object).length === 0);
		return empty ? "var(--mantine-color-dimmed)" : "var(--mantine-color-green-6)";
	};

	const handleCancelAi = () => {
		abortRef.current?.abort();
		abortRef.current = null;
		toast.success("已取消生成");
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

	const isDirty = state.isDirty && JSON.stringify(state.json) !== state.initialJson;

	/** 返回到病例库：未保存时先确认，避免刷掉一整页编辑。 */
	const handleBack = async () => {
		if (isDirty) {
			const ok = await confirm({ title: "离开病例工作台", message: "内容未保存，确定离开？" });
			if (!ok) return;
		}
		navigate(CASES_LIST_PATH);
	};

	/**
	 * 发布：先取门禁报告再落版本。
	 *
	 * 门禁报告与「保存被拒」共用同一个字段级视图（CaseValidationReportView）；
	 * 只有草稿才能发布，归档病例没有任何写动作。
	 */
	const openGate = async () => {
		if (caseId == null) return;
		setCaseMsg("");
		setGateLoading(true);
		try {
			const { data: report } = await getCaseValidation(caseId);
			setGateReport(report);
		} catch (err: unknown) {
			toast.apiError(err, "获取发布校验结果失败");
		} finally {
			setGateLoading(false);
		}
	};

	const confirmPublish = async () => {
		if (caseId == null || !gateReport?.publishable) return;
		setPublishing(true);
		try {
			const { data } = await publishMutation.mutateAsync(caseId);
			toast.success(`「${data.case.name}」已发布 v${data.case.current_revision_no ?? 1}`);
			if (!data.case.is_open) {
				toast.info("病例已发布但未向学生开放：在病例库打开「学生可见」后学生才能使用");
			}
			setGateReport(null);
			void detailQuery.refetch();
		} catch (err: unknown) {
			const report = publishReportOf(err);
			if (report) setGateReport(report);
			else toast.apiError(err, "发布失败");
		} finally {
			setPublishing(false);
		}
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

	// 生成中计时（取消按钮旁显示）
	useEffect(() => {
		if (!aiBusy) return;
		setAiElapsed(0);
		const timer = setInterval(() => setAiElapsed((v) => v + 1), 1000);
		return () => clearInterval(timer);
	}, [aiBusy]);

	/** 教学细节是否已具备（与后端派生阶段校验口径一致）。 */
	const hasPedagogy = Boolean(
		(state.json.required_inquiries as unknown[] | undefined)?.length ||
			Object.keys(objField(state, "activities.physical_exam.config")).length > 0,
	);
	// 临床骨架是否已有内容：教学细节生成以骨架为上下文，空骨架产出质量差（2026-09-26 防呆）
	const hasSkeleton = Boolean(
		String(state.json.name ?? "").trim() &&
			(String(state.json.chief_complaint ?? "").trim() || String(state.json.present_illness ?? "").trim()),
	);

	const caseName = String(state.json.name ?? "").trim();
	const title = caseId == null ? "新建病例" : loaded ? caseName || "病例工作台" : "病例工作台";
	const subtitle =
		caseId == null
			? "先建草稿：填写临床骨架与教学细节，发布后才能用于作业与训练"
			: published
				? "已发布病例：保存内容变化会立即生效并产生新版本"
				: archived
					? "已归档病例：内容冻结，仅可查看"
					: "草稿：保存后可发布，发布前会先过发布门禁";

	return (
		<Stack gap="md">
			<PageHeader
				title={title}
				subtitle={subtitle}
				icon={IconForms}
				backTo={CASES_LIST_PATH}
				actions={
					<Group gap={8} wrap="wrap">
						{caseId != null && loaded && !detailError && (
							<CaseStatusBadge status={status} revisionNo={revisionNo} size="sm" />
						)}
						<Button
							variant="default"
							size="sm"
							leftSection={<IconChevronLeft size={14} />}
							onClick={() => { void handleBack(); }}
						>
							返回病例库
						</Button>
					</Group>
				}
			/>

			{/* 详情加载：加载中 / 失败（可重试） / 正常 */}
			{caseId != null && detailQuery.isLoading && <LoadingSkeleton variant="card" />}
			{caseId != null && detailError && (
				<ErrorState
					title={detailErrorStatus === 404 ? "找不到这个病例" : "加载病例失败"}
					error={detailQuery.error}
					description={detailErrorStatus === 404 ? "它可能已被删除，或链接里的编号有误。" : undefined}
					onRetry={() => { void detailQuery.refetch(); }}
				/>
			)}

			{loaded && !detailError && (
				<>
					{published && (
						<Alert variant="light" color="blue">
							<Text size="sm">
								该病例已发布{revisionNo != null ? `（当前 v${revisionNo}）` : ""}：保存内容变化会立即生效并产生新版本，
								旧训练仍按各自版本复盘；保存前会先过发布门禁，未通过则不会落库。
							</Text>
						</Alert>
					)}
					{archived && (
						<Alert variant="light" color="orange">
							<Text size="sm">该病例已归档，内容已冻结、不能再编辑（历史版本与既有训练保留）。</Text>
						</Alert>
					)}

					{caseMsg && (
						<Alert variant="light" color="red">
							{caseMsg}
						</Alert>
					)}

					{saveReport && (
						<Paper withBorder p="sm">
							<CaseValidationReportView report={saveReport} />
						</Paper>
					)}

					{showDraftRestore && (
						<Alert variant="light" color="yellow">
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
					<Group gap={8} wrap="wrap">
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

						{caseId != null && (
							<Button
								size="xs"
								variant={showRevisions ? "filled" : "outline"}
								color="gray"
								onClick={() => setShowRevisions(!showRevisions)}
								leftSection={<IconHistory size={13} />}
							>
								版本历史
							</Button>
						)}

						{caseId != null && status === "draft" && (
							<Button
								size="xs"
								variant="light"
								color="green"
								onClick={() => { void openGate(); }}
								loading={gateLoading}
								leftSection={<IconRocket size={13} />}
							>
								发布
							</Button>
						)}

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

					{/* ── 版本历史：页内面板（不再叠第二层 Modal） ── */}
					{showRevisions && caseId != null && (
						<Paper withBorder p="md">
							<Stack gap="xs">
								<Group justify="space-between" align="center">
									<Title order={3} size="h6">版本历史</Title>
									<Button size="compact-xs" variant="subtle" color="gray" onClick={() => setShowRevisions(false)}>
										收起
									</Button>
								</Group>
								<Text size="xs" c="dimmed">
									已发布版本不可修改；编辑已发布病例会追加新版本，旧训练仍按各自版本复盘。
								</Text>
								{revisionsQuery.isLoading ? (
									<Group gap={8} py="sm">
										<Loader size={14} />
										<Text size="sm" c="dimmed">加载中…</Text>
									</Group>
								) : revisionsQuery.isError ? (
									<ErrorState
										title="版本历史加载失败"
										error={revisionsQuery.error}
										onRetry={() => { void revisionsQuery.refetch(); }}
									/>
								) : (revisionsQuery.data?.length ?? 0) === 0 ? (
									<Text size="sm" c="dimmed">该病例还没有已发布版本（发布后才会产生 v1）。</Text>
								) : (
									<Table.ScrollContainer minWidth={320}>
										<Table verticalSpacing={6} horizontalSpacing="sm">
											<Table.Thead>
												<Table.Tr>
													<Table.Th><Text size="xs" c="dimmed" fw={600}>版本</Text></Table.Th>
													<Table.Th><Text size="xs" c="dimmed" fw={600}>时间</Text></Table.Th>
												</Table.Tr>
											</Table.Thead>
											<Table.Tbody>
												{revisionsQuery.data?.map((r) => (
													<Table.Tr key={r.id}>
														<Table.Td>
															<Group gap={6} wrap="nowrap">
																<Badge variant={r.is_current ? "filled" : "light"} color={r.is_current ? "green" : "gray"} size="xs">
																	v{r.revision_no}
																</Badge>
																{r.is_current && <Text size="xs" c="dimmed">当前版本</Text>}
															</Group>
														</Table.Td>
														<Table.Td>
															<Text size="xs" c="dimmed">
																{r.published_at
																	? `发布 ${formatDateTime(r.published_at)}`
																	: `创建 ${formatDateTime(r.created_at)}`}
															</Text>
														</Table.Td>
													</Table.Tr>
												))}
											</Table.Tbody>
										</Table>
									</Table.ScrollContainer>
								)}
							</Stack>
						</Paper>
					)}

					{/* ── 发布门禁：先看字段级报告，通过才允许发布 ── */}
					{gateReport && caseId != null && (
						<Paper withBorder p="md">
							<Stack gap="sm">
								<Group justify="space-between" align="center" wrap="wrap" gap="xs">
									<Group gap={8} wrap="wrap">
										<Title order={3} size="h6">发布门禁</Title>
										<CaseStatusBadge status={status} revisionNo={revisionNo} />
									</Group>
									<Group gap={6}>
										<Button size="compact-xs" variant="subtle" color="gray" onClick={() => setGateReport(null)} disabled={publishing}>
											关闭
										</Button>
										<Button
											size="compact-xs"
											variant="subtle"
											leftSection={<IconRotate size={12} />}
											onClick={() => { void openGate(); }}
											disabled={publishing || gateLoading}
										>
											重新校验
										</Button>
										<Button
											size="compact-xs"
											color="green"
											onClick={() => { void confirmPublish(); }}
											loading={publishing}
											disabled={!gateReport.publishable}
										>
											确认发布
										</Button>
									</Group>
								</Group>
								<CaseValidationReportView report={gateReport} />
							</Stack>
						</Paper>
					)}

					{/* ── AI 面板：两步向导 + 逐字段生成 ── */}
					{showAiPanel && (
						<Paper withBorder p="md" bg="var(--mantine-color-brand-light)" style={{ borderColor: "var(--mantine-color-brand-outline)" }} >
							{/* 两步向导：用 Stepper 表达"当前步/已完成"，而不是两个绿/灰徽章 */}
							<Stepper
								size="xs"
								iconSize={22}
								active={hasSkeleton ? 1 : 0}
								allowNextStepsSelect={false}
								mb="sm"
							>
								<Stepper.Step label="临床骨架" description={hasSkeleton ? "已具备" : "待生成"} />
								<Stepper.Step label="教学细节" description={hasPedagogy ? "已具备" : "待生成"} />
							</Stepper>

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
										placeholder={referenceQuery.isLoading ? "加载病例…" : "选择参考病例"}
										nothingFoundMessage="没有可参考的病例"
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

							{lastMeta && (
								<Text size="xs" c="dimmed" mb="xs">
									上次生成：{(lastMeta.elapsedMs / 1000).toFixed(1)}s
									{lastMeta.usage?.total_tokens ? ` · ${lastMeta.usage.total_tokens} tokens` : ""}
									{lastMeta.warnings.length > 0 ? ` · ${lastMeta.warnings.join("；")}` : ""}
								</Text>
							)}

							{/* 两步按钮 */}
							{aiBusy && (
								<Group gap={8} align="center" mb="xs">
									<Text size="xs" c="dimmed">生成中，已用 {aiElapsed}s</Text>
									<Button size="compact-xs" variant="light" color="gray" onClick={handleCancelAi}>
										取消
									</Button>
								</Group>
							)}
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
										<Button
											key={f.key}
											size="xs"
											variant="light"
											color="brand"
											onClick={() => generateField(f.key)}
											disabled={aiBusy}
											leftSection={
												<Box style={{ width: 6, height: 6, borderRadius: 999, background: fieldDot(f.key) }} />
											}
										>
											{f.label}
										</Button>
									))}
								</Group>
								<Group gap={6} wrap="wrap">
									<Text size="xs" c="brand" style={{ flexShrink: 0, width: 56 }}>教学字段</Text>
									{AI_PEDAGOGY_FIELDS.map((f) => (
										<Button
											key={f.key}
											size="xs"
											variant="light"
											color="brand"
											onClick={() => generateField(f.key)}
											disabled={aiBusy}
											leftSection={
												<Box style={{ width: 6, height: 6, borderRadius: 999, background: fieldDot(f.key) }} />
											}
										>
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
									<ScrollArea.Autosize mah={320}>
										<Stack gap={6}>
											{pendingAi.changes.map((c) => (
												<Group key={c.path} gap={8} align="flex-start" wrap="nowrap">
													<Checkbox
														size="xs"
														mt={2}
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
									</ScrollArea.Autosize>
								</Stack>
							)}
						</Paper>
					)}

					{/* ── 病例预览（只读学生视角） ── */}
					{showPreview && (
						<Paper withBorder p="md">
							<Text size="xs" fw={600} mb="xs">学生可见预览</Text>
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
						<Stack gap="md" pb={72}>
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
								style={{ position: "sticky", bottom: 0, zIndex: 2, background: "var(--mantine-color-body)", borderTop: "1px solid var(--mantine-color-default-border)" }}
							>
								{caseId != null && revisionsQuery.data == null && !archived && (
									<Text size="xs" c="dimmed" mr="auto">
										{published ? `当前 v${revisionNo ?? 1}` : "草稿：发布后产生 v1"}
									</Text>
								)}
								<Button type="button" variant="outline" size="sm" onClick={() => { void handleBack(); }}>取消</Button>
								<Button
									type="submit"
									size="sm"
									disabled={archived || loadFailed || createMutation.isPending || updateMutation.isPending}
									title={
										archived
											? "已归档病例内容冻结，不可保存"
											: loadFailed
												? "病例数据加载失败，当前内容是默认骨架，重试成功前不可保存"
												: undefined
									}
								>
									{caseId != null
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

					{archived && (
						<Group gap={8} wrap="wrap">
							<IconArchive size={14} />
							<Text size="xs" c="dimmed">
								归档不可撤销；需要继续维护请{" "}
								<Anchor component={Link} to={CASES_LIST_PATH} size="xs">回到病例库</Anchor>
								新建病例。
							</Text>
						</Group>
					)}
				</>
			)}
		</Stack>
	);
}
