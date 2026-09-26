import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListFilters } from "@/hooks/useListFilters";

/**
 * `useListFilters` 是列表参数与导出参数的唯一构造点：这里钉住四条对外可观察的行为
 * （其中两条对应 2026-09-26 修掉的真实缺陷，见 ui-improvement-plan §6.5.2）。
 */
type Params = {
	search?: string;
	role?: string;
	include_inactive?: boolean;
	is_open?: boolean | "";
};

const INITIAL: Params = { search: "", role: "", include_inactive: false, is_open: "" };

function setup(initial: Params = INITIAL, limit = 50) {
	return renderHook(() => useListFilters<Params>(initial, { limit, searchKey: "search" }));
}

describe("useListFilters", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("空值不进请求，false 与 0 保留", () => {
		const { result } = setup();
		expect(result.current.params).toEqual({ offset: 0, limit: 50, include_inactive: false });
	});

	it("改筛选即归零 offset", () => {
		const { result } = setup();
		act(() => result.current.setOffset(60));
		expect(result.current.offset).toBe(60);
		act(() => result.current.setFilter("role", "student"));
		expect(result.current.offset).toBe(0);
		expect(result.current.params).toMatchObject({ offset: 0, role: "student" });
	});

	it("搜索防抖 300ms 后才进请求，且输入即归零 offset（回归）", () => {
		const { result } = setup();
		act(() => result.current.setOffset(60));
		act(() => result.current.onSearchChange("肺炎"));
		// 输入即时可见，但尚未进请求
		expect(result.current.searchInput).toBe("肺炎");
		expect(result.current.offset).toBe(0);
		expect(result.current.params.search).toBeUndefined();
		act(() => vi.advanceTimersByTime(299));
		expect(result.current.params.search).toBeUndefined();
		act(() => vi.advanceTimersByTime(1));
		expect(result.current.params.search).toBe("肺炎");
	});

	it("reset 同步复位防抖值，清除后请求不再带旧搜索词（回归）", () => {
		const { result } = setup();
		act(() => result.current.onSearchChange("崩溃"));
		act(() => vi.advanceTimersByTime(400));
		expect(result.current.params.search).toBe("崩溃");
		act(() => result.current.setFilter("role", "teacher"));
		act(() => result.current.reset());
		// 输入框与"已生效值"必须一起清：否则清单已复位、请求仍带旧搜索词
		expect(result.current.searchInput).toBe("");
		expect(result.current.params.search).toBeUndefined();
		expect(result.current.params.role).toBeUndefined();
		// 复位后推进时间也不会把旧词"迟到"地送回请求
		act(() => vi.advanceTimersByTime(1000));
		expect(result.current.params.search).toBeUndefined();
	});

	it("hasActiveFilters 以偏离初始值判定：默认值不算活跃（回归）", () => {
		const { result } = setup();
		expect(result.current.hasActiveFilters).toBe(false);
		// 显式设回默认值仍非活跃
		act(() => result.current.setFilter("include_inactive", false));
		expect(result.current.hasActiveFilters).toBe(false);
		act(() => result.current.setFilter("include_inactive", true));
		expect(result.current.hasActiveFilters).toBe(true);
		act(() => result.current.setFilter("include_inactive", false));
		expect(result.current.hasActiveFilters).toBe(false);
		// 搜索（防抖后）也要算活跃
		act(() => result.current.onSearchChange("张"));
		act(() => vi.advanceTimersByTime(400));
		expect(result.current.hasActiveFilters).toBe(true);
		act(() => result.current.reset());
		expect(result.current.hasActiveFilters).toBe(false);
	});

	it("exportParams 与 params 同源、只去掉分页键", () => {
		const { result } = setup();
		act(() => result.current.setFilter("role", "student"));
		act(() => result.current.onSearchChange("李"));
		act(() => vi.advanceTimersByTime(400));
		expect(result.current.exportParams).toEqual({ search: "李", role: "student", include_inactive: false });
		expect(Object.keys(result.current.exportParams)).not.toContain("offset");
		expect(Object.keys(result.current.exportParams)).not.toContain("limit");
		// 布尔 false 是有效筛选值，不能被当成"空"
		act(() => result.current.setFilter("is_open", false));
		expect(result.current.exportParams.is_open).toBe(false);
	});
});
