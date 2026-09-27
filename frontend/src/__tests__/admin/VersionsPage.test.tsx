import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VersionsPage from "@/pages/admin/VersionsPage";

const mocks = vi.hoisted(() => ({
	getVersionAttribution: vi.fn(),
}));

vi.mock("@/api/admin/versions", () => ({
	getVersionAttribution: mocks.getVersionAttribution,
}));

function renderPage() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<VersionsPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

function attribution(items: unknown[], overrides: Record<string, unknown> = {}) {
	return {
		data: {
			by: "prompt",
			window_days: 90,
			truncated: false,
			totals: { records: 3, identities: items.length },
			items,
			...overrides,
		},
	};
}

beforeEach(() => {
	mocks.getVersionAttribution.mockReset();
});

describe("VersionsPage", () => {
	it("按身份渲染使用量与平均分，缺成绩时明确显示而不是 0", async () => {
		mocks.getVersionAttribution.mockResolvedValue(
			attribution([
				{
					identity: "history_taking@abc123def456",
					records: 5,
					scored: 3,
					avg_score: 87.5,
					fallback_rate: 0.0,
					first_seen: "2026-09-01T00:00:00Z",
					last_seen: "2026-09-20T00:00:00Z",
				},
				{
					identity: "unknown",
					records: 2,
					scored: 0,
					avg_score: null,
					fallback_rate: null,
					first_seen: null,
					last_seen: null,
				},
			]),
		);

		renderPage();

		const table = within(await screen.findByRole("table"));
		expect(table.getByText("history_taking@abc123def456")).toBeTruthy();
		expect(table.getByText("87.5")).toBeTruthy();
		// 身份不可知的历史记录显示为 unknown，且"无成绩 ≠ 0 分"
		expect(table.getByText("unknown")).toBeTruthy();
		expect(table.getByText("无成绩")).toBeTruthy();
		expect(screen.getByText(/2 个身份 · 3 条记录/)).toBeTruthy();
	});

	it("截断与空态都被如实呈现", async () => {
		mocks.getVersionAttribution.mockResolvedValue(
			attribution([], { truncated: true, totals: { records: 20000, identities: 0 } }),
		);

		renderPage();

		expect(await screen.findByText("该窗口内没有记录")).toBeTruthy();
		await waitFor(() => expect(mocks.getVersionAttribution).toHaveBeenCalledTimes(1));
	});

	it("切换时间窗口就按新窗口取数；「清除」复位为默认窗口（90 天）", async () => {
		const row = (identity: string) => ({
			identity,
			records: 1,
			scored: 1,
			avg_score: 88,
			fallback_rate: 0,
			first_seen: null,
			last_seen: null,
		});
		// 每个窗口回一份可辨认的数据：清除后表格必须回到 90 天那份（= 请求键回到默认窗口）
		mocks.getVersionAttribution.mockImplementation(async (params: { window_days: number }) =>
			attribution([row(`window${params.window_days}@abc123def456`)]),
		);

		renderPage();

		const windowInput = await screen.findByRole("combobox", { name: "时间窗口" });
		expect(windowInput.getAttribute("value")).toBe("近 90 天");
		await screen.findByText("window90@abc123def456");
		// 未偏离默认值时没有"清除"，也不该出现搜索框（聚合页无行可搜）
		expect(screen.queryByRole("button", { name: "清除" })).toBeNull();
		expect(screen.queryByPlaceholderText(/搜索/)).toBeNull();

		await userEvent.click(windowInput);
		const listbox = document.getElementById(windowInput.getAttribute("aria-controls") ?? "");
		await userEvent.click(
			within(listbox as HTMLElement).getByRole("option", { name: "近 30 天", hidden: true }),
		);

		await waitFor(() =>
			expect(mocks.getVersionAttribution).toHaveBeenLastCalledWith({
				by: "prompt",
				window_days: 30,
			}),
		);
		expect(windowInput.getAttribute("value")).toBe("近 30 天");
		await screen.findByText("window30@abc123def456");

		await userEvent.click(screen.getByRole("button", { name: "清除" }));

		await screen.findByText("window90@abc123def456");
		expect(windowInput.getAttribute("value")).toBe("近 90 天");
		expect(screen.queryByRole("button", { name: "清除" })).toBeNull();
	});
});
