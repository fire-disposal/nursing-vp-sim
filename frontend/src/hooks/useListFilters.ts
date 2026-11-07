import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
	/**
	 * 把筛选与分页写进地址栏（刷新、分享链接、前进后退都能回到同一视图）。
	 *
	 * 用 `history.replaceState` 而不是 router state：不触发路由重渲染，
	 * 也不会在每次输入时堆历史记录；挂载时从地址栏恢复。
	 */
	urlSync?: boolean;
}

/** URL 值 → 筛选值：按初始值的类型还原 number/boolean，其余保持字符串。 */
function coerceFromUrl(raw: string, reference: unknown): unknown {
	if (typeof reference === "number") {
		const n = Number(raw);
		return Number.isFinite(n) ? n : reference;
	}
	if (typeof reference === "boolean") {
		return raw === "true" ? true : raw === "false" ? false : reference;
	}
	return raw;
}

function readFromUrl<TParams extends Record<string, unknown>>(initial: TParams): { values: TParams; offset: number } {
	if (typeof window === "undefined") return { values: initial, offset: 0 };
	const sp = new URLSearchParams(window.location.search);
	const values: Record<string, unknown> = { ...initial };
	for (const [key, value] of sp.entries()) {
		// 只恢复本页认识的键：SPA 跳转后地址栏可能还留着上一页的筛选，别带进请求
		if (key === "offset" || !(key in initial)) continue;
		values[key] = coerceFromUrl(value, (initial as Record<string, unknown>)[key]);
	}
	const offset = Number(sp.get("offset") ?? 0);
	return { values: values as TParams, offset: Number.isFinite(offset) && offset >= 0 ? offset : 0 };
}

function writeToUrl(values: Record<string, unknown>, offset: number): void {
	// jsdom（vitest）的 about:blank 不能用 replaceState，测试环境直接跳过
	if (typeof window === "undefined" || !/^https?:$/.test(window.location.protocol)) return;
	const sp = new URLSearchParams(window.location.search);
	for (const [key, value] of Object.entries(values)) {
		if (isBlank(value)) sp.delete(key);
		else sp.set(key, String(value));
	}
	if (offset > 0) sp.set("offset", String(offset));
	else sp.delete("offset");
	const qs = sp.toString();
	window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
}

export function useListFilters<TParams extends Record<string, unknown>>(
	initial: TParams,
	{ limit, searchKey, debounceMs = 300, urlSync = false }: UseListFiltersOptions,
) {
	// 地址栏恢复只做一次（之后由 effect 单向写回）
	const restoredRef = useRef<{ values: TParams; offset: number } | null>(null);
	const restore = () => {
		if (!urlSync) return { values: initial, offset: 0 };
		restoredRef.current ??= readFromUrl(initial);
		return restoredRef.current;
	};
	// 自己管防抖（不用 useDebouncedSearch）：reset() 必须能同步清掉"输入框"与"已生效值"，
	// 否则清除后请求仍会带旧搜索词。
	const [searchInput, setSearchInput] = useState(() =>
		searchKey ? String(restore().values[searchKey] ?? "") : "",
	);
	const [debouncedValue, setDebouncedValue] = useState(searchInput);
	useEffect(() => {
		if (!searchKey) return;
		const timer = setTimeout(() => setDebouncedValue(searchInput), debounceMs);
		return () => clearTimeout(timer);
	}, [searchInput, searchKey, debounceMs]);

	const [values, setValues] = useState<TParams>(() => restore().values);
	const [offset, setOffset] = useState(() => restore().offset);
	// 初始值只认首次：既作 reset() 的目标，也作"是否偏离初始态"的比较基准
	const initialRef = useRef(initial);

	// 搜索键以防抖后的值为准，其余筛选立即生效
	const effective = useMemo(
		() => (searchKey ? { ...values, [searchKey]: debouncedValue } : values),
		[values, searchKey, debouncedValue],
	);

	/** 实际生效的筛选值（搜索键=防抖后的值）：要按"真正发出去了什么"派生 UI 时用它。 */
	const activeValues = effective;

	// 地址栏是视图快照：默认值不写（保持链接干净），非默认值随时同步
	useEffect(() => {
		if (!urlSync) return;
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(effective)) {
			if (isBlank(value) || value === initialRef.current[key]) continue;
			out[key] = value;
		}
		writeToUrl(out, offset);
	}, [effective, offset, urlSync]);

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

	/** 有活跃筛选 = 至少一个键既非空、又偏离初始值（`include_inactive:false` 这类默认值不算）。 */
	const hasActiveFilters = useMemo(
		() =>
			Object.entries(effective).some(
				([key, value]) => !isBlank(value) && value !== initialRef.current[key],
			),
		[effective],
	);

	const setFilter = useCallback(
		<K extends keyof TParams & string>(key: K, value: TParams[K]) => {
			setOffset(0);
			if (searchKey === key) {
				setSearchInput(String(value ?? ""));
				setDebouncedValue(String(value ?? "")); // 程序化改值不走防抖，立即生效
			}
			setValues((prev) => ({ ...prev, [key]: value }));
		},
		[searchKey, setSearchInput],
	);

	// 搜索框的 onChange 也必须归零 offset：否则在第 3 页输入搜索会落到过滤后的空页
	const onSearchChange = useCallback((value: string) => {
		setOffset(0);
		setSearchInput(value);
	}, []);

	const reset = useCallback(() => {
		setOffset(0);
		setValues(initialRef.current);
		if (searchKey) {
			const value = String(initialRef.current[searchKey] ?? "");
			setSearchInput(value);
			setDebouncedValue(value);
		}
	}, [searchKey]);

	return {
		values,
		activeValues,
		searchInput,
		onSearchChange,
		setFilter,
		reset,
		offset,
		setOffset,
		params,
		exportParams,
		hasActiveFilters,
	};
}
