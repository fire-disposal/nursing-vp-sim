import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";

interface ListResult<T> {
	items: T[];
	total: number;
}

export interface AdminListParams<F> {
	search: string;
	offset: number;
	limit: number;
	filters: F;
}

export interface UseAdminListOptions<T, F extends Record<string, unknown>> {
	queryKey: (params: AdminListParams<F>) => readonly unknown[];
	queryFn: (params: AdminListParams<F>) => Promise<ListResult<T>>;
	limit?: number;
	staleTime?: number;
	debounceMs?: number;
	initialFilters?: F;
}

/**
 * Shared admin-list logic: debounced search + pagination + filters +
 * TanStack Query integration + CRUD modal state.
 *
 * Pairs with the `<DataTable>` view component. Search/filter controls are
 * rendered by the page (outside DataTable). Offset auto-resets when the
 * debounced search or any filter changes.
 */
export function useAdminList<
	T,
	F extends Record<string, unknown> = Record<string, never>,
>(opts: UseAdminListOptions<T, F>) {
	const {
		limit = 20,
		staleTime = 60_000,
		debounceMs = 200,
		initialFilters = {} as F,
	} = opts;

	const { searchInput, debouncedValue, handleSearchChange } = useDebouncedSearch(
		"",
		debounceMs,
	);
	const [offset, setOffset] = useState(0);
	const [filters, setFilters] = useState<F>(initialFilters);
	const [showModal, setShowModal] = useState(false);
	const [editingItem, setEditingItem] = useState<T | null>(null);

	useEffect(() => {
		setOffset(0);
	}, [debouncedValue, filters]);

	const params: AdminListParams<F> = {
		search: debouncedValue,
		offset,
		limit,
		filters,
	};
	const query = useQuery({
		queryKey: opts.queryKey(params),
		queryFn: () => opts.queryFn(params),
		placeholderData: keepPreviousData,
		staleTime,
	});

	const setFilter = useCallback(
		<K extends keyof F>(key: K, value: F[K]) => {
			setFilters((prev) => ({ ...prev, [key]: value }));
		},
		[],
	);
	const openCreate = useCallback(() => {
		setEditingItem(null);
		setShowModal(true);
	}, []);
	const openEdit = useCallback((item: T) => {
		setEditingItem(item);
		setShowModal(true);
	}, []);
	const closeModal = useCallback(() => {
		setShowModal(false);
		setEditingItem(null);
	}, []);

	return {
		items: query.data?.items ?? [],
		total: query.data?.total ?? 0,
		isLoading: query.isLoading,
		isFetching: query.isFetching,
		refetch: query.refetch,
		searchInput,
		debouncedValue,
		handleSearchChange,
		offset,
		limit,
		setOffset,
		filters,
		setFilter,
		setFilters,
		showModal,
		editingItem,
		openCreate,
		openEdit,
		closeModal,
	} as const;
}

export default useAdminList;
