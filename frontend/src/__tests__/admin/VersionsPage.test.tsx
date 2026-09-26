import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@/__tests__/render";
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
});
