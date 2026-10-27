import { Button, Select, Stack } from "@mantine/core";
import { IconArrowLeft, IconClipboardCheck, IconPlus } from "@tabler/icons-react";
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
import { TYPE_OPTIONS, emptyForm } from "@/components/admin/questionnaires/types";
import {
	useAssignTemplateMutation,
	useDeleteTemplateMutation,
	useSaveTemplateMutation,
} from "@/components/admin/questionnaires/useQuestionnaireMutations";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import { useConfirm } from "@/components/ui/confirm";
import ErrorState from "@/components/ui/error-state";
import ListPage from "@/components/ui/list-page";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { getApiErrorDetail } from "@/utils/error";
import { useListFilters } from "@/hooks/useListFilters";

export default function QuestionnairesTab() {
	const [view, setView] = useState<ViewMode>("list");
	const [showEditor, setShowEditor] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [form, setForm] = useState<TemplateForm>(emptyForm());
	/** 编辑器打开/载入时的快照：关闭前据此判断"有没有未保存的改动"。 */
	const [editorBaseline, setEditorBaseline] = useState("");
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
			const next = {
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
			};
			setForm(next);
			setEditorBaseline(JSON.stringify(next));
		}
	}, [editingId, templateDetail, showEditor]);

	const openNew = () => {
		const blank = emptyForm();
		setEditingId(null);
		setForm(blank);
		setEditorBaseline(JSON.stringify(blank));
		setEditMsg("");
		setShowEditor(true);
	};

	const openEdit = (t: TemplateListItem) => {
		setEditingId(t.id);
		setEditMsg("");
		setShowEditor(true);
	};

	// 与其它表单同一范式：有未保存改动时先确认，别让点遮罩/× 把改动静默丢掉
	const closeEditor = async (options: { force?: boolean } = {}) => {
		if (!options.force && editorBaseline && JSON.stringify(form) !== editorBaseline) {
			const ok = await confirm({
				title: "未保存的更改",
				message: "问卷内容未保存，确定关闭？",
				danger: true,
			});
			if (!ok) return;
		}
		setShowEditor(false);
		setEditingId(null);
		setForm(emptyForm());
		setEditorBaseline("");
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
					// 已保存：关窗不再询问（否则刚保存完又被"未保存的更改"拦一下）
					void closeEditor({ force: true });
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
			{/* 页头与本 Tab 共享同一份状态：主行动（新建问卷）和列表筛选都在这里，
			    由 Tab 自己渲染页头，父级页面只负责路由（同 UsersTab）。 */}
			<ListPage
				header={
					<PageHeader
						title="问卷管理"
						subtitle="管理前后测问卷模板、分配病例、查看数据"
						icon={IconClipboardCheck}
						actions={
							<Button leftSection={<IconPlus size={16} />} onClick={openNew}>
								新建问卷
							</Button>
						}
					/>
				}
				toolbar={
					// 统一工具栏：计数 / 筛选 / 搜索 + 一键复位（与其余列表页同范式）
					<FilterToolbar
						compact
						summary={`共 ${total} 条`}
						hasActiveFilters={list.hasActiveFilters}
						onClear={list.reset}
						search={
							<SearchInput
								value={list.searchInput}
								onChange={list.onSearchChange}
								placeholder="搜索标题..."
							/>
						}
						filters={
							<>
								<Select
									size="sm"
									placeholder="问卷类型"
									data={TYPE_OPTIONS}
									value={list.values.type || null}
									onChange={(v) => list.setFilter("type", v ?? "")}
									w={130}
								/>
								<Select
									size="sm"
									placeholder="状态"
									data={[
										{ value: "", label: "全部" },
										{ value: "active", label: "启用" },
										{ value: "inactive", label: "禁用" },
									]}
									value={
										list.values.is_active === undefined || list.values.is_active === null
											? null
											: list.values.is_active
												? "active"
												: "inactive"
									}
									onChange={(v) =>
										list.setFilter("is_active", v === "" || v == null ? undefined : v === "active")
									}
									w={110}
								/>
							</>
						}
					/>
				}
				footer={
					total > 0 ? (
						<Pagination
							total={total}
							offset={list.offset}
							limit={LIMIT}
							onChange={list.setOffset}
						/>
					) : undefined
				}
			>
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
						onEdit={openEdit}
						onDelete={handleDelete}
						onAssign={openAssign}
						onViewStats={openStats}
					/>
				)}
			</ListPage>

			<QuestionnaireEditor
				open={showEditor}
				editingId={editingId}
				form={form}
				editMsg={editMsg}
				isLoadingDetail={isLoadingDetail}
				isSaving={saveMutation.isPending}
				onClose={() => { void closeEditor(); }}
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
