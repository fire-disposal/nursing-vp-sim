import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getManageCases } from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import CaseFormModal from "./cases/CaseForm";
import CaseList from "./cases/CaseList";
import type { CaseManageItem } from "./cases/types";
import { useDeleteCase, useDeleteCaseConfirm } from "./cases/useCaseMutations";

const LIMIT = 50;

export default function CasesTab() {
  const [showEditor, setShowEditor] = useState(false);
  const queryClient = useQueryClient();
  const [editingCase, setEditingCase] = useState<CaseManageItem | null>(null);
  const [startWithAiPanel, setStartWithAiPanel] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({ name: "", difficulty: "" });
  const [searchText, setSearchText] = useState("");

  const params: Record<string, unknown> = { offset, limit: LIMIT };
  if (filters.name) params.name = filters.name;
  if (filters.difficulty) params.difficulty = filters.difficulty;

  const { data: caseData } = useQuery({
    queryKey: queryKeys.cases.managed.list(params),
    queryFn: () => getManageCases(params).then((r) => r.data),
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });

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

  const handleFilterChange = (newFilters: { name: string; difficulty: string }) => {
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
        searchText={searchText}
        onSearchChange={(v) => setSearchText(v)}
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
        onSaved={() => queryClient.invalidateQueries({ queryKey: queryKeys.cases.managed.list({}) })}
      />
    </>
  );
}
