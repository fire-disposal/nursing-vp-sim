import { Button, Stack } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getCases } from "@/api/cases";
import type { QuestionnaireTemplateParams } from "@/api/query-params";
import { queryKeys } from "@/api/query-keys";
import {
	getQuestionnaireStats,
	getQuestionnairesTemplates,
	getQuestionnaireTemplate,
} from "@/api/questionnaires";
import QuestionnaireAssign from "@/components/admin/questionnaires/QuestionnaireAssign";
import QuestionnaireEditor from "@/components/admin/questionnaires/QuestionnaireEditor";
import QuestionnaireList from "@/components/admin/questionnaires/QuestionnaireList";
import QuestionnaireStats from "@/components/admin/questionnaires/QuestionnaireStats";
import type {
	AssignForm,
	CaseBrief,
	ResponseStats,
	TemplateDetail,
	TemplateForm,
	TemplateListItem,
	ViewMode,
} from "@/components/admin/questionnaires/types";
import { emptyForm } from "@/components/admin/questionnaires/types";
import {
	useAssignTemplateMutation,
	useDeleteTemplateMutation,
	useSaveTemplateMutation,
} from "@/components/admin/questionnaires/useQuestionnaireMutations";
import { useConfirm } from "@/components/ui/confirm";
import ErrorState from "@/components/ui/error-state";
import { getApiErrorDetail } from "@/utils/error";
import { useListFilters } from "@/hooks/useListFilters";

export default function QuestionnairesTab() {
	const [view, setView] = useState<ViewMode>("list");
	const [showEditor, setShowEditor] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [form, setForm] = useState<TemplateForm>(emptyForm());
	const [editMsg, setEditMsg] = useState("");
	const [statsTemplate, setStatsTemplate] = useState<TemplateListItem | null>(
		null,
	);
	const [showAssign, setShowAssign] = useState(false);
	const [assignTemplate, setAssignTemplate] = useState<TemplateListItem | null>(
		null,
	);
	const [assignForm, setAssignForm] = useState<AssignForm>({
		case_ids: [],
		is_required: true,
		trigger_event: "before_training",
	});
	const LIMIT = 20;
	// 筛选的唯一持有者：type / search（防抖）/ is_active 与后端 QuestionnaireTemplateFilters 同源
	const list = useListFilters<QuestionnaireTemplateParams>(
		{ type: "", search: "", is_active: undefined },
		{ limit: LIMIT, searchKey: "search" },
	);

	const { confirm } = useConfirm();

	const saveMutation = useSaveTemplateMutation();
	const deleteMutation = useDeleteTemplateMutation();
	const assignMutation = useAssignTemplateMutation();

	const {
		data: templatesData,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		queryKey: queryKeys.questionnaires.templates(list.params),
		queryFn: () => getQuestionnairesTemplates(list.params).then((r) => r.data),
		placeholderData: (prev) => prev,
		staleTime: 5 * 60_000,
	});

	const templates: TemplateListItem[] = templatesData?.items ?? [];
	const total = templatesData?.total ?? 0;

	const { data: casesData } = useQuery({
		queryKey: queryKeys.cases.student(),
		queryFn: () =>
			getCases({ limit: 100 }).then((r) => r.data),
		enabled: showAssign,
		staleTime: 5 * 60_000,
	});

	const allCases: CaseBrief[] = casesData?.items ?? [];

	const {
		data: templateDetail,
		isLoading: isLoadingDetail,
		isError: isDetailError,
		error: detailError,
	} = useQuery({
		queryKey: queryKeys.questionnaires.detail(editingId),
		queryFn: () =>
			getQuestionnaireTemplate(editingId!).then((r) => r.data as TemplateDetail),
		enabled: editingId !== null && showEditor,
		staleTime: 5 * 60_000,
	});

	const {
		data: statsData,
		isLoading: isLoadingStats,
		isError: isStatsError,
		error: statsError,
		refetch: refetchStats,
	} = useQuery({
		queryKey: queryKeys.questionnaires.stats(statsTemplate?.id ?? null),
		queryFn: () =>
			getQuestionnaireStats(statsTemplate!.id).then((r) => r.data),
		enabled: view === "stats" && statsTemplate !== null,
		staleTime: 2 * 60_000,
	});

	const stats: ResponseStats | null = statsData ?? null;

	// 详情取不到时编辑器里是一张空表单：不吭声会让人以为模板本身就是空的，
	// 所以把错误塞进编辑器自己的错误横幅（表单/详情页统一走 getApiErrorDetail）。
	useEffect(() => {
		if (!isDetailError) return;
		setEditMsg(getApiErrorDetail(detailError, "问卷详情加载失败，请返回列表重试"));
	}, [isDetailError, detailError]);

	useEffect(() => {
		if (editingId && templateDetail && showEditor) {
			setForm({
				title: templateDetail.title,
				type: templateDetail.type,
				description: templateDetail.description || "",
				is_active: templateDetail.is_active,
				questions: templateDetail.questions.map((q) => ({
					id: q.id,
					content: q.content,
					question_type: q.question_type,
					required: q.required,
					sort_order: q.sort_order,
					options: q.options || [],
				})),
			});
		}
	}, [editingId, templateDetail, showEditor]);

	const openNew = () => {
		setEditingId(null);
		setForm(emptyForm());
		setEditMsg("");
		setShowEditor(true);
	};

	const openEdit = (t: TemplateListItem) => {
		setEditingId(t.id);
		setEditMsg("");
		setShowEditor(true);
	};

	const closeEditor = () => {
		setShowEditor(false);
		setEditingId(null);
		setForm(emptyForm());
		setEditMsg("");
	};

	const validateForm = (): boolean => {
		if (!form.title.trim()) {
			setEditMsg("请输入问卷标题");
			return false;
		}
		if (form.title.trim().length > 200) {
			setEditMsg("问卷标题不能超过200个字符");
			return false;
		}
		for (let i = 0; i < form.questions.length; i++) {
			if (!form.questions[i].content.trim()) {
				setEditMsg(`第 ${i + 1} 题的内容不能为空`);
				return false;
			}
		}
		return true;
	};

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setEditMsg("");
		if (!validateForm()) return;
		saveMutation.mutate(
			{ form, editingId },
			{
				onSuccess: () => {
					closeEditor();
				},
				onError: (err: unknown) => {
					// detail 可能是 pydantic 的数组：直接上屏会触发 React child 白屏
					setEditMsg(getApiErrorDetail(err, "保存失败"));
				},
			},
		);
	};

	const handleDelete = async (t: TemplateListItem) => {
		const ok = await confirm({
			title: "删除问卷模板",
			message: `确定删除问卷"${t.title}"吗？此操作将同时删除该问卷的全部学生答卷，不可恢复。`,
			confirmLabel: "确定删除",
			danger: true,
		});
		if (!ok) return;
		deleteMutation.mutate(t.id);
	};

	const openAssign = async (t: TemplateListItem) => {
		setAssignTemplate(t);
		try {
			const detail: TemplateDetail = await getQuestionnaireTemplate(t.id).then(
				(r) => r.data,
			);
			setAssignForm({
				case_ids: detail.case_ids || [],
				is_required: true,
				trigger_event: "before_training",
			});
		} catch {
			setAssignForm({
				case_ids: [],
				is_required: true,
				trigger_event: "before_training",
			});
		}
		setShowAssign(true);
	};

	const closeAssign = () => {
		setShowAssign(false);
		setAssignTemplate(null);
	};

	const handleAssignSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (assignTemplate) {
			assignMutation.mutate(
				{ templateId: assignTemplate.id, payload: assignForm },
				{
					onSuccess: () => {
						closeAssign();
					},
				},
			);
		}
	};

	const openStats = (t: TemplateListItem) => {
		setStatsTemplate(t);
		setView("stats");
	};

	const backToList = () => {
		setView("list");
		setStatsTemplate(null);
	};

	if (view === "stats" && statsTemplate) {
		// 统计取数失败不能交给统计组件：stats 为 null 时它会渲染成「0 分配 / 0 完成」的假数据
		if (isStatsError) {
			return (
				<Stack gap="md">
					<Button
						variant="subtle"
						color="gray"
						size="sm"
						leftSection={<IconArrowLeft size={14} />}
						onClick={backToList}
						style={{ alignSelf: "flex-start" }}
					>
						返回列表
					</Button>
					<ErrorState
						title="统计数据加载失败"
						error={statsError}
						onRetry={() => refetchStats()}
					/>
				</Stack>
			);
		}
		return (
			<QuestionnaireStats
				template={statsTemplate}
				stats={stats}
				isLoading={isLoadingStats}
				onBack={backToList}
			/>
		);
	}

	return (
		<>
			{/* 失败 ≠ 没有问卷模板：落到列表空态会让人以为模板被删光，进而建出重复模板 */}
			{isError ? (
				<ErrorState
					title="问卷模板加载失败"
					error={error}
					onRetry={() => refetch()}
				/>
			) : (
			<QuestionnaireList
				templates={templates}
				isLoading={isLoading}
				total={total}
				offset={list.offset}
				limit={LIMIT}
				typeFilter={list.values.type ?? ""}
				searchText={list.searchInput}
				statusFilter={
					list.values.is_active === undefined || list.values.is_active === null
						? ""
						: list.values.is_active
							? "active"
							: "inactive"
				}
				onOffsetChange={list.setOffset}
				onTypeFilterChange={(v) => list.setFilter("type", v)}
				onSearchChange={list.onSearchChange}
				hasActiveFilters={list.hasActiveFilters}
				onClear={list.reset}
				onStatusFilterChange={(v) =>
					list.setFilter("is_active", v === "" ? undefined : v === "active")
				}
				onCreate={openNew}
				onEdit={openEdit}
				onDelete={handleDelete}
				onAssign={openAssign}
				onViewStats={openStats}
			/>
			)}

			<QuestionnaireEditor
				open={showEditor}
				editingId={editingId}
				form={form}
				editMsg={editMsg}
				isLoadingDetail={isLoadingDetail}
				isSaving={saveMutation.isPending}
				onClose={closeEditor}
				onSave={handleSave}
				setForm={setForm}
			/>

			<QuestionnaireAssign
				open={showAssign}
				templateTitle={assignTemplate?.title || ""}
				allCases={allCases}
				assignForm={assignForm}
				isSaving={assignMutation.isPending}
				onClose={closeAssign}
				onSubmit={handleAssignSubmit}
				onAssignFormChange={setAssignForm}
			/>
		</>
	);
}
