import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../render";
import MyFeedbackPage from "@/pages/share/MyFeedback";
import VersionsPage from "@/pages/ops/VersionsPage";
import SystemNotificationsPage from "@/pages/ops/SystemNotificationsPage";
import CostDashboard from "@/pages/ops/cost/CostDashboard";
import FeedbackTab from "@/components/admin/FeedbackTab";

const mocks = vi.hoisted(() => ({
	getMyFeedback: vi.fn(),
	getVersionAttribution: vi.fn(),
	getSystemNotifications: vi.fn(),
	getAppSettings: vi.fn(),
	fetchCostDashboard: vi.fn(),
	fetchUserCostBreakdown: vi.fn(),
	getFeedbacks: vi.fn(),
	getFeedbackStats: vi.fn(),
}));

vi.mock("@/api/admin/feedback", () => ({
	getMyFeedback: mocks.getMyFeedback,
	feedbackImageUrl: vi.fn(),
}));
vi.mock("@/api/admin/versions", () => ({ getVersionAttribution: mocks.getVersionAttribution }));
vi.mock("@/api/admin/system-notifications", () => ({
	getSystemNotifications: mocks.getSystemNotifications,
	createSystemNotification: vi.fn(),
	updateSystemNotification: vi.fn(),
	deleteSystemNotification: vi.fn(),
}));
vi.mock("@/api/settings", () => ({
	getAppSettings: mocks.getAppSettings,
	updateAppSettings: vi.fn(),
}));
vi.mock("@/api/admin/voice-cost", () => ({
	fetchCostDashboard: mocks.fetchCostDashboard,
	fetchUserCostBreakdown: mocks.fetchUserCostBreakdown,
}));
vi.mock("@/api", () => ({
	getFeedbacks: mocks.getFeedbacks,
	getFeedbackStats: mocks.getFeedbackStats,
	feedbackImageUrl: vi.fn(),
	replyFeedback: vi.fn(),
}));

function renderPage(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>{ui}</MemoryRouter>
		</QueryClientProvider>,
	);
}

async function expectErrorAndRetry(emptyText: string) {
	const errorTitle = await screen.findByText("加载失败", { exact: false });
	expect(errorTitle).toBeVisible();
	expect(screen.queryByText(emptyText, { exact: false })).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "重试" }));
}

describe("查询失败不得伪装成空态", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAppSettings.mockReturnValue(new Promise(() => {}));
	});

	it("我的反馈：显示错误与重试，不显示暂无反馈", async () => {
		mocks.getMyFeedback.mockRejectedValue(new Error("offline"));
		renderPage(<MyFeedbackPage />);
		await expectErrorAndRetry("暂无反馈");
		await waitFor(() => expect(mocks.getMyFeedback).toHaveBeenCalledTimes(2));
	});

	it("版本归因：显示错误，不显示该窗口没有记录", async () => {
		mocks.getVersionAttribution.mockRejectedValue(new Error("offline"));
		renderPage(<VersionsPage />);
		await expectErrorAndRetry("该窗口内没有记录");
		await waitFor(() => expect(mocks.getVersionAttribution).toHaveBeenCalledTimes(2));
	});

	it("系统通知：显示错误，不显示暂无通知", async () => {
		mocks.getSystemNotifications.mockRejectedValue(new Error("offline"));
		renderPage(<SystemNotificationsPage />);
		await expectErrorAndRetry("暂无通知");
		await waitFor(() => expect(mocks.getSystemNotifications).toHaveBeenCalledTimes(2));
	});

	it("成本总览：显示错误，不显示本月零费用", async () => {
		mocks.fetchCostDashboard.mockRejectedValue(new Error("offline"));
		renderPage(<CostDashboard />);
		await expectErrorAndRetry("本月还没有费用记录");
		await waitFor(() => expect(mocks.fetchCostDashboard).toHaveBeenCalledTimes(2));
	});

	it("系统反馈：显示错误，不显示暂无反馈", async () => {
		mocks.getFeedbacks.mockRejectedValue(new Error("offline"));
		renderPage(<FeedbackTab />);
		await expectErrorAndRetry("暂无反馈");
		await waitFor(() => expect(mocks.getFeedbacks).toHaveBeenCalledTimes(2));
	});
});
