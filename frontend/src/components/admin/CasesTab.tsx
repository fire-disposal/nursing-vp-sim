import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { Button, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { getCaseValidation, getManageCases, publishReportOf, toggleCaseOpen } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import CaseFormModal from "./cases/CaseForm";
import CaseList, { type CaseListFilters } from "./cases/CaseList";
import { CaseStatusBadge } from "./cases/CaseStatusBadge";
import CaseValidationReportView from "./cases/CaseValidationReportView";
import { useArchiveCase, useDeleteCase, useDeleteCaseConfirm, usePublishCase } from "./cases/useCaseMutations";

type CaseManageItem = components["schemas"]["CaseManageItem"];
type CaseValidationReport = components["schemas"]["CaseValidationReport"];

const LIMIT = 50;

const EMPTY_FILTERS: CaseListFilters = { name: "", difficulty: "", status: "", is_open: "" };

/** 发布门禁弹窗状态：先取 validation，有 error 时只读展示并阻止发布。 */
interface GateState {
	item: CaseManageItem;
	report: CaseValidationReport | null;
	publishing: boolean;
}

export default function CasesTab() {
	const [showEditor, setShowEditor] = useState(false);
	const queryClient = useQueryClient();
	const toast = useToast();
	const { confirm } = useConfirm();
	const [editingCase, setEditingCase] = useState<CaseManageItem | null>(null);
	const [startWithAiPanel, setStartWithAiPanel] = useState(false);
	const [offset, setOffset] = useState(0);
	const [filters, setFilters] = useState<CaseListFilters>(EMPTY_FILTERS);
	const [pendingId, setPendingId] = useState<number | null>(null);
	const [gate, setGate] = useState<GateState | null>(null);
	const { searchInput, debouncedValue, handleSearchChange } = useDebouncedSearch(
		"",
		300,
	);

	const params: Record<string, unknown> = { offset, limit: LIMIT };
	if (filters.name) params.name = filters.name;
	if (filters.difficulty) params.difficulty = Number(filters.difficulty);
	if (filters.status) params.status = filters.status;
	if (filters.is_open) params.is_open = filters.is_open === "true";

	const { data: caseData, isError, isLoading, refetch } = useQuery({
		queryKey: queryKeys.cases.managed.list(params),
		queryFn: () => getManageCases(params).then((r) => r.data),
		placeholderData: (prev) => prev,
		staleTime: 5 * 60_000,
	});

	useEffect(() => {
		if (isError) {
			toast.error("加载病例列表失败，请检查网络后重试");
		}
	}, [isError, toast.error]);

	useEffect(() => {
		setFilters((f) => ({ ...f, name: debouncedValue }));
		setOffset(0);
	}, [debouncedValue]);

	const cases = caseData?.items ?? [];
	const total = caseData?.total ?? 0;

	const deleteMutation = useDeleteCase();
	const publishMutation = usePublishCase();
	const archiveMutation = useArchiveCase();
	const checkAndConfirm = useDeleteCaseConfirm();

	const handleAdd = () => {
		setEditingCase(null);
		setStartWithAiPanel(false);
		setShowEditor(true);
	};

	const handleAIAdd = () => {
		setEditingCase(null);
		setStartWithAiPanel(true);
		setShowEditor(true);
	};

	const handleEdit = (c: CaseManageItem) => {
		setEditingCase(c);
		setStartWithAiPanel(false);
		setShowEditor(true);
	};

	const handleDelete = async (c: CaseManageItem) => {
		const ok = await checkAndConfirm(c);
		if (!ok) return;
		setPendingId(c.id);
		deleteMutation.mutate(c.id, { onSettled: () => setPendingId(null) });
	};

	const handleToggleOpen = async (c: CaseManageItem) => {
		setPendingId(c.id);
		try {
			await toggleCaseOpen(c.id, !c.is_open);
			await queryClient.invalidateQueries({
				queryKey: queryKeys.cases.managed.all,
			});
		} catch (err: unknown) {
			toast.apiError(err, "操作失败");
		} finally {
			setPendingId(null);
		}
	};

	/** 发布第一步：取门禁报告（字段级 error/warning），由弹窗决定是否放行。 */
	const openGate = async (c: CaseManageItem) => {
		setPendingId(c.id);
		setGate({ item: c, report: null, publishing: false });
		try {
			const { data: report } = await getCaseValidation(c.id);
			setGate((prev) => (prev ? { ...prev, report } : prev));
		} catch (err: unknown) {
			setGate(null);
			toast.apiError(err, "获取发布校验结果失败");
		} finally {
			setPendingId(null);
		}
	};

	const confirmPublish = async () => {
		if (!gate?.report?.publishable) return;
		const { item } = gate;
		setGate({ ...gate, publishing: true });
		try {
			const { data } = await publishMutation.mutateAsync(item.id);
			toast.success(`「${data.case.name}」已发布 v${data.case.current_revision_no ?? 1}`);
			if (!data.case.is_open) {
				toast.info("病例已发布但未向学生开放：点击列表中的开关后学生才能使用");
			}
			setGate(null);
		} catch (err: unknown) {
			const report = publishReportOf(err);
			if (report) {
				setGate((prev) => (prev ? { ...prev, report, publishing: false } : prev));
			} else {
				toast.apiError(err, "发布失败");
				setGate((prev) => (prev ? { ...prev, publishing: false } : prev));
			}
		}
	};

	const handleArchive = async (c: CaseManageItem) => {
		const ok = await confirm({
			title: "归档病例",
			message: `归档「${c.name}」后不能再编辑，也不能用于新作业与训练（历史版本与既有训练保留，不可恢复）。确定归档？`,
			confirmLabel: "确定归档",
			danger: true,
		});
		if (!ok) return;
		setPendingId(c.id);
		try {
			await archiveMutation.mutateAsync(c.id);
			toast.success("病例已归档");
		} catch (err: unknown) {
			toast.apiError(err, "归档失败");
		} finally {
			setPendingId(null);
		}
	};

	const handleFilterChange = (newFilters: CaseListFilters) => {
		setFilters(newFilters);
		setOffset(0);
	};

	return (
		<>
			<CaseList
				cases={cases}
				total={total}
				offset={offset}
				limit={LIMIT}
				filters={filters}
				searchInput={searchInput}
				loading={isLoading}
				error={isError}
				pendingId={pendingId}
				onSearchChange={handleSearchChange}
				onFilterChange={handleFilterChange}
				onOffsetChange={setOffset}
				onRetry={() => { void refetch(); }}
				onAdd={handleAdd}
				onAIAdd={handleAIAdd}
				onEdit={handleEdit}
				onDelete={handleDelete}
				onToggleOpen={handleToggleOpen}
				onPublish={(c) => { void openGate(c); }}
				onArchive={(c) => { void handleArchive(c); }}
			/>
			<CaseFormModal
				open={showEditor}
				editingCase={editingCase}
				startWithAiPanel={startWithAiPanel}
				availableCases={cases}
				onClose={() => setShowEditor(false)}
				onSaved={() =>
					queryClient.invalidateQueries({
						queryKey: queryKeys.cases.managed.all,
					})
				}
			/>
			<Modal
				opened={gate != null}
				onClose={() => setGate(null)}
				title="发布病例"
				size={560}
				centered
				withinPortal
			>
				{gate && (
					<Stack gap="md">
						<Group gap={8} wrap="wrap">
							<Text size="sm" fw={600}>{gate.item.name}</Text>
							<CaseStatusBadge status={gate.item.status} revisionNo={gate.item.current_revision_no} />
						</Group>
						{gate.report ? (
							<CaseValidationReportView report={gate.report} />
						) : (
							<Group gap={8}>
								<Loader size={16} />
								<Text size="sm" c="dimmed">正在运行发布门禁…</Text>
							</Group>
						)}
						<Group justify="flex-end" gap={8}>
							<Button variant="outline" size="sm" onClick={() => setGate(null)} disabled={gate.publishing}>
								取消
							</Button>
							<Button
								variant="subtle"
								size="sm"
								leftSection={<IconRefresh size={13} />}
								onClick={() => { void openGate(gate.item); }}
								disabled={gate.publishing}
							>
								重新校验
							</Button>
							<Button
								size="sm"
								onClick={() => { void confirmPublish(); }}
								loading={gate.publishing}
								disabled={!gate.report?.publishable}
							>
								确认发布
							</Button>
						</Group>
					</Stack>
				)}
			</Modal>
		</>
	);
}
