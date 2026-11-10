import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../render";
import OpsErrorDetailPage from "@/pages/ops/OpsErrorDetailPage";
import SystemOpsPage from "@/pages/ops/SystemOpsPage";
import {
	normalizeFingerprint,
	resolveBackendGroups,
	resolveFrontendGroups,
} from "@/api/admin/ops";
import type * as OpsApi from "@/api/admin/ops";

const mocks = vi.hoisted(() => ({ fetchDiagnose: vi.fn() }));

vi.mock("@/api/admin/ops", async () => {
	const actual = await vi.importActual<typeof OpsApi>("@/api/admin/ops");
	return { ...actual, fetchDiagnose: mocks.fetchDiagnose };
});

/** 一次完整的诊断响应（只含本页读到的键）。 */
function diagnose(overrides: Record<string, unknown> = {}) {
	const now = new Date().toISOString();
	return {
		llm: { total_calls_24h: 0, success_rate: 100, error_count_24h: 0, avg_latency_ms: 0, recent_errors: [] },
		scoring: { pending: 0, in_progress: 0, completed_24h: 0, failed_24h: 0, success_rate: 100 },
		jobs: null,
		voice: { tts: { calls_24h: 0, success_rate: 100, error_count_24h: 0, avg_latency_ms: 0, cost_24h: 0 } },
		voice_budget: { monthly_budget: 0, monthly_cost: 0, usage_pct: 0 },
		business: { today_users: 0, today_trainings: 0, today_completed: 0 },
		metrics: {},
		errors: {
			scope: "workers",
			window: "rolling_60m",
			window_by_count: {},
			count: { last_5min: 0, last_hour: 0, total_captured: 0, unique_24h: 0 },
			recent: [],
			groups: [],
		},
		frontend_errors: {
			scope: "workers",
			window: "rolling_60m",
			window_by_count: {},
			count: { last_5min: 0, last_hour: 0, total_captured: 0, unique_24h: 0 },
			groups: [],
			...((overrides.frontend_errors as object) ?? {}),
		},
		alerts: [],
		cached_at: now,
		...overrides,
	};
}

function renderAt(path: string) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route path="/admin/system-ops" element={<SystemOpsPage />} />
					<Route path="/admin/system-ops/errors/:fingerprint" element={<OpsErrorDetailPage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

const BACKEND_GROUP = {
	fingerprint: "f1a69d3c1fff9b62",
	level: "ERROR",
	logger: "modules.training.chat",
	message: "TimeoutError: slow retry failed",
	messages: ["TimeoutError: slow retry failed", "ConnectionResetError: peer reset"],
	count: 27,
	first_seen: "2026-11-10T08:00:00+00:00",
	last_seen: "2026-11-10T08:10:00+00:00",
	source: "archive",
	version: "1.4.2",
};

describe("运维错误组下钻", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("运维页把每个错误组渲染成指向详情路由的真链接", async () => {
		mocks.fetchDiagnose.mockResolvedValue({
			data: diagnose({ errors: { ...diagnose().errors, groups: [BACKEND_GROUP] } }),
		});
		renderAt("/admin/system-ops");

		const link = await screen.findByRole("link", {
			name: /查看错误组 f1a69d3c1fff9b62 详情/,
		});
		expect(link).toHaveAttribute(
			"href",
			"/admin/system-ops/errors/f1a69d3c1fff9b62",
		);
	});

	it("详情页显示真实指纹、来源、级别、次数与首末时间", async () => {
		mocks.fetchDiagnose.mockResolvedValue({
			data: diagnose({ errors: { ...diagnose().errors, groups: [BACKEND_GROUP] } }),
		});
		renderAt(`/admin/system-ops/errors/${BACKEND_GROUP.fingerprint}`);

		// 最近消息 + 变体列表都会渲染同一字符串（变体 1 即最近消息），故用 getAllByText
		expect((await screen.findAllByText("TimeoutError: slow retry failed")).length).toBeGreaterThan(0);
		expect(screen.getAllByText(BACKEND_GROUP.fingerprint).length).toBeGreaterThan(0);
		expect(screen.getByText("modules.training.chat")).toBeVisible();
		expect(screen.getByText("ERROR")).toBeVisible();
		expect(screen.getByText("27")).toBeVisible();
		// 消息变体全部列出（不是只显示最近一条）
		expect(screen.getByText("ConnectionResetError: peer reset")).toBeVisible();
	});

	it("前端遥测组显示 URL / UA / 组件栈与只读用户编号", async () => {
		const feFingerprint = "b1f0c0a2e3d4f5a6";
		mocks.fetchDiagnose.mockResolvedValue({
			data: diagnose({
				frontend_errors: {
					...diagnose().frontend_errors,
					groups: [
						{
							fingerprint: feFingerprint,
							type: "TypeError",
							message: "Object.hasOwn is not a function",
							url: "/training/538",
							user_id: 67,
							ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/92.0.4515.131",
							source: "ErrorBoundary",
							component_stack: "at Ga (markdown.js:14:12727)",
							count: 12,
							time: new Date().toISOString(),
							first_seen: new Date().toISOString(),
						},
					],
				},
			}),
		});
		renderAt(`/admin/system-ops/errors/${feFingerprint}`);

		expect(await screen.findByText("/training/538")).toBeVisible();
		expect(screen.getByText(/Chrome\/92\.0\.4515\.131/)).toBeVisible();
		expect(screen.getByText("at Ga (markdown.js:14:12727)")).toBeVisible();
		expect(screen.getByText("用户 #67")).toBeVisible();
		expect(screen.queryByRole("link", { name: "用户 #67" })).not.toBeInTheDocument();
		// 不伪造 request id / 处理人 / 已解决状态
		expect(screen.queryByText(/request_id/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/已解决/)).not.toBeInTheDocument();
	});

	it("窗口内查不到指纹时诚实说明并可返回", async () => {
		mocks.fetchDiagnose.mockResolvedValue({ data: diagnose() });
		renderAt("/admin/system-ops/errors/deadbeefdeadbeef");

		expect(await screen.findByText("当前窗口内没有该指纹")).toBeVisible();
		expect(
			screen.getByRole("link", { name: "返回运维仪表盘" }),
		).toHaveAttribute("href", "/admin/system-ops");
		// 不得把「查不到」渲染成空表格或伪造内容
		expect(screen.queryByText("27")).not.toBeInTheDocument();
	});

	it("查询失败显示错误与重试，而不是「没有该指纹」", async () => {
		mocks.fetchDiagnose.mockRejectedValue(new Error("offline"));
		renderAt("/admin/system-ops/errors/f1a69d3c1fff9b62");

		expect(await screen.findByText("诊断数据加载失败")).toBeVisible();
		expect(screen.queryByText("当前窗口内没有该指纹")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /重试/ }));
		await waitFor(() => expect(mocks.fetchDiagnose).toHaveBeenCalledTimes(2));
	});

	it("滚动出窗口的组仍然展示，但标注已超出窗口", async () => {
		mocks.fetchDiagnose.mockResolvedValue({
			data: diagnose({
				errors: {
					...diagnose().errors,
					groups: [
						{
							...BACKEND_GROUP,
							first_seen: "2026-01-01T00:00:00+00:00",
							last_seen: "2026-01-01T00:05:00+00:00",
						},
					],
				},
			}),
		});
		renderAt(`/admin/system-ops/errors/${BACKEND_GROUP.fingerprint}`);
		expect(await screen.findByText("已超出当前窗口")).toBeVisible();
	});
});

describe("错误组归一化", () => {
	it("只有 recent 行时按指纹聚合次数与首末时间", () => {
		const groups = resolveBackendGroups({
			scope: "workers",
			window_by_count: {},
			count: { last_5min: 0, last_hour: 0, total_captured: 0, unique_24h: 0 },
			recent: [
				{
					time: "2026-11-10T08:10:00+00:00",
					level: "ERROR",
					logger: "a",
					message: "boom",
					fingerprint: "fp1",
				},
				{
					time: "2026-11-10T08:00:00+00:00",
					level: "ERROR",
					logger: "a",
					message: "boom",
					fingerprint: "fp1",
				},
			],
		});
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(2);
		expect(groups[0].first_seen).toBe("2026-11-10T08:00:00+00:00");
		expect(groups[0].last_seen).toBe("2026-11-10T08:10:00+00:00");
		// 数据源没有变体列表时不得编造
		expect(groups[0].messages).toBeUndefined();
	});

	it("前端组缺指纹时过滤掉，不透传可点进去必然查不到的行", () => {
		const groups = resolveFrontendGroups({
			scope: "workers",
			window: "rolling_60m",
			window_by_count: {},
			count: { last_5min: 2, last_hour: 2, total_captured: 2, unique_24h: 2 },
			groups: [
				{
					time: "2026-11-10T08:00:00+00:00",
					type: "TypeError",
					message: "no fingerprint here",
					url: "/x",
					user_id: 0,
					count: 1,
					source: "ErrorBoundary",
				},
				{
					fingerprint: "b1f0c0a2e3d4f5a6",
					time: "2026-11-10T08:01:00+00:00",
					type: "TypeError",
					message: "has fingerprint",
					url: "/y",
					user_id: 7,
					count: 1,
				},
			],
		});
		expect(groups).toHaveLength(1);
		expect(groups[0].fingerprint).toBe("b1f0c0a2e3d4f5a6");
	});

	it("recent 降级只聚合服务端带指纹的行", () => {
		const groups = resolveBackendGroups({
			scope: "workers",
			window_by_count: {},
			count: { last_5min: 0, last_hour: 0, total_captured: 0, unique_24h: 0 },
			recent: [
				{ time: "2026-11-10T08:00:00+00:00", level: "ERROR", logger: "a", message: "no fp" },
				{
					time: "2026-11-10T08:01:00+00:00",
					level: "ERROR",
					logger: "a",
					message: "with fp",
					fingerprint: "fp1",
				},
			],
		});
		expect(groups).toHaveLength(1);
		expect(groups[0].fingerprint).toBe("fp1");
	});

	it("地址里的指纹做解码与合法性校验", () => {
		expect(normalizeFingerprint("abc123")).toBe("abc123");
		expect(normalizeFingerprint("%61bc")).toBe("abc");
		expect(normalizeFingerprint("%E0%A4%A")).toBeNull();
		expect(normalizeFingerprint("a/b")).toBeNull();
		expect(normalizeFingerprint("")).toBeNull();
	});
});
