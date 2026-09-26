import { useCallback, useMemo, useState } from "react";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";

/**
 * 列表筛选的唯一持有者：筛选值 → 请求参数只在这里构造一次。
 *
 * 约定（与后端「筛选 DTO + Depends」成对）：
 * - `params` 给列表请求，`exportParams` 给导出按钮 —— 两者同源，导出不会再漏筛；
 * - 文本搜索指定 `searchKey`，控件即时、进请求前防抖；
 * - 空值（""/undefined/null）不进请求；`false`、`0` 是有效筛选值，必须保留；
 * - 改动任意筛选都把 offset 归零（避免"筛完停在空页"）。
 */
function isBlank(value: unknown): boolean {
	return value === "" || value === undefined || value === null;
}

export interface UseListFiltersOptions {
	/** 每页条数 */
	limit: number;
	/** 需要防抖的文本搜索键 */
	searchKey?: string;
	debounceMs?: number;
}

export function useListFilters<TParams extends Record<string, unknown>>(
	initial: TParams,
	{ limit, searchKey, debounceMs = 300 }: UseListFiltersOptions,
) {
	const { searchInput, debouncedValue, handleSearchChange, setSearchInput } = useDebouncedSearch(
		searchKey ? String(initial[searchKey] ?? "") : "",
		debounceMs,
	);
	const [values, setValues] = useState<TParams>(initial);
	const [offset, setOffset] = useState(0);

	// 搜索键以防抖后的值为准，其余筛选立即生效
	const effective = useMemo(
		() => (searchKey ? { ...values, [searchKey]: debouncedValue } : values),
		[values, searchKey, debouncedValue],
	);

	const params = useMemo(() => {
		const out: Record<string, unknown> = { offset, limit };
		for (const [key, value] of Object.entries(effective)) {
			if (!isBlank(value)) out[key] = value;
		}
		return out as TParams & { offset: number; limit: number };
	}, [effective, offset, limit]);

	const exportParams = useMemo(() => {
		const { offset: _offset, limit: _limit, ...rest } = params;
		return rest;
	}, [params]);

	const setFilter = useCallback(
		<K extends keyof TParams & string>(key: K, value: TParams[K]) => {
			setOffset(0);
			if (searchKey === key) setSearchInput(String(value ?? ""));
			setValues((prev) => ({ ...prev, [key]: value }));
		},
		[searchKey, setSearchInput],
	);

	// 搜索框的 onChange 也必须归零 offset：否则在第 3 页输入搜索会落到过滤后的空页
	const onSearchChange = useCallback(
		(value: string) => {
			setOffset(0);
			handleSearchChange(value);
		},
		[handleSearchChange],
	);

	const reset = useCallback(() => {
		setOffset(0);
		setValues(initial);
		if (searchKey) setSearchInput(String(initial[searchKey] ?? ""));
	}, [initial, searchKey, setSearchInput]);

	return {
		values,
		searchInput,
		onSearchChange,
		setFilter,
		reset,
		offset,
		setOffset,
		params,
		exportParams,
	};
}
