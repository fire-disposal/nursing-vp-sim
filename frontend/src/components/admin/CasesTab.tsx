import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getManageCases, toggleCaseOpen } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import type { CaseManageParams } from "@/api/query-params";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { useListFilters } from "@/hooks/useListFilters";
import { editCasePath } from "./cases/CaseForm";
import CaseList, { type CaseListFilters } from "./cases/CaseList";
import { useArchiveCase, useDeleteCase, useDeleteCaseConfirm } from "./cases/useCaseMutations";

type CaseManageItem = components["schemas"]["CaseManageItem"];

const LIMIT = 50;

/** 筛选初始值：键与 /cases/manage/list 的 query 参数同源（difficulty/is_open 已是 number/boolean）。 */
const INITIAL_FILTERS: CaseManageParams = { name: "", difficulty: null, status: "", is_open: null };

interface CasesTabProps {
	/** 导出参数（与列表参数同源）→ 页头的导出按钮，避免"筛完再导仍是全量"。 */
	onExportParamsChange?: (params: Record<string, unknown>) => void;
	/** 页头（PageHeader）：主行动是去病例工作台的真链接，由页头排版。 */
	renderHeader?: () => ReactNode;
}

/**
 * 病例库列表：只负责筛选、列表与行内生命周期动作。
 *
 * 新建/编辑/AI 生成**不再**打开本页的弹窗，而是进独立工作台页
 * （`/admin/cases/new`、`/admin/cases/:caseId`）。列表这边不再持有任何编辑器状态，
 * 连"发布门禁弹窗"也一起搬到了工作台（见 CaseForm 的保存/发布校验）。
 */
export default function CasesTab({ onExportParamsChange, renderHeader }: CasesTabProps) {
	// 筛选只有一个持有者：值 → 请求参数（含导出参数）由 useListFilters 构造一次
	const list = useListFilters<CaseManageParams>(INITIAL_FILTERS, { limit: LIMIT, searchKey: "name", urlSync: true });
	const queryClient = useQueryClient();
	const toast = useToast();
	const { confirm } = useConfirm();
	const [pendingId, setPendingId] = useState<number | null>(null);

	// 筛选只有一个持有者（useListFilters）：下拉是字符串语义，只在边界与 hook 的 number/boolean 互转
	const filters: CaseListFilters = {
		name: list.searchInput,
		difficulty: list.values.difficulty == null ? "" : String(list.values.difficulty),
		status: list.values.status ?? "",
		is_open: list.values.is_open == null ? "" : String(list.values.is_open),
	};

	const handleFilterChange = (next: CaseListFilters) => {
		list.setFilter("name", next.name);
		list.setFilter("difficulty", next.difficulty ? Number(next.difficulty) : null);
		list.setFilter("status", next.status);
		list.setFilter("is_open", next.is_open ? next.is_open === "true" : null);
	};

	// 导出参数与列表参数同源（useListFilters 构造），不再手工拼第二份
	useEffect(() => {
		onExportParamsChange?.(list.exportParams);
	}, [list.exportParams, onExportParamsChange]);

	const { data: caseData, isError, isLoading, refetch } = useQuery({
		queryKey: queryKeys.cases.managed.list(list.params),
		queryFn: () => getManageCases(list.params).then((r) => r.data),
		placeholderData: (prev) => prev,
		staleTime: 5 * 60_000,
	});

	useEffect(() => {
		if (isError) {
			toast.error("加载病例列表失败，请检查网络后重试");
		}
	}, [isError, toast.error]);

	const cases = caseData?.items ?? [];
	const total = caseData?.total ?? 0;

	const deleteMutation = useDeleteCase();
	const archiveMutation = useArchiveCase();
	const checkAndConfirm = useDeleteCaseConfirm();

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

	return (
		<CaseList
			header={renderHeader?.()}
			cases={cases}
			total={total}
			offset={list.offset}
			limit={LIMIT}
			filters={filters}
			searchInput={list.searchInput}
			loading={isLoading}
			error={isError}
			pendingId={pendingId}
			onSearchChange={list.onSearchChange}
			hasFilters={list.hasActiveFilters}
			onFilterChange={handleFilterChange}
			onOffsetChange={list.setOffset}
			onRetry={() => { void refetch(); }}
			caseHref={editCasePath}
			onDelete={handleDelete}
			onToggleOpen={handleToggleOpen}
			onArchive={handleArchive}
		/>
	);
}
