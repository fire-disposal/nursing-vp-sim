import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getManageCases } from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import CaseFormModal from "./cases/CaseForm";
import CaseList from "./cases/CaseList";
import type { CaseManageItem } from "./cases/types";
import { useDeleteCase, useDeleteCaseConfirm } from "./cases/useCaseMutations";

const LIMIT = 50;

export default function CasesTab() {
	const [showEditor, setShowEditor] = useState(false);
	const queryClient = useQueryClient();
	const toast = useToast();
	const [editingCase, setEditingCase] = useState<CaseManageItem | null>(null);
	const [startWithAiPanel, setStartWithAiPanel] = useState(false);
	const [offset, setOffset] = useState(0);
	const [filters, setFilters] = useState({ name: "", difficulty: "" });
	const { searchInput, debouncedValue, handleSearchChange } = useDebouncedSearch(
		"",
		300,
	);

	const params: Record<string, unknown> = { offset, limit: LIMIT };
	if (filters.name) params.name = filters.name;
	if (filters.difficulty) params.difficulty = filters.difficulty;

	const { data: caseData, isError } = useQuery({
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
		deleteMutation.mutate(c.id);
	};

	const handleFilterChange = (newFilters: {
		name: string;
		difficulty: string;
	}) => {
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
				onSearchChange={handleSearchChange}
				onFilterChange={handleFilterChange}
				onOffsetChange={setOffset}
				onAdd={handleAdd}
				onAIAdd={handleAIAdd}
				onEdit={handleEdit}
				onDelete={handleDelete}
			/>
			<CaseFormModal
				open={showEditor}
				editingCase={editingCase}
				startWithAiPanel={startWithAiPanel}
				availableCases={cases}
				onClose={() => setShowEditor(false)}
				onSaved={() =>
					queryClient.invalidateQueries({
						queryKey: queryKeys.cases.managed.list({}),
					})
				}
			/>
		</>
	);
}
