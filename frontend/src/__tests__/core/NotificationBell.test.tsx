import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@/__tests__/render";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotificationBell from "@/components/NotificationBell";

const apiMock = vi.hoisted(() => ({
	getNotifications: vi.fn(),
}));

vi.mock("@/api/notifications", () => ({
	getNotifications: apiMock.getNotifications,
	markAllNotificationsRead: vi.fn(),
	markNotificationRead: vi.fn(),
	markNotificationUnread: vi.fn(),
}));

function renderBell() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter>
				<NotificationBell />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

afterEach(() => {
	vi.clearAllMocks();
});

describe("NotificationBell 未读徽标", () => {
	it("面板从未打开也显示未读总数（不受列表分页门控）", async () => {
		apiMock.getNotifications.mockResolvedValue({
			data: { items: [], total: 37, offset: 0, limit: 1 },
		});

		renderBell();

		expect(await screen.findByText("37")).toBeInTheDocument();
		expect(apiMock.getNotifications).toHaveBeenCalledWith({ unread_only: true, limit: 1 });
	});

	it("无未读时不渲染徽标", async () => {
		apiMock.getNotifications.mockResolvedValue({
			data: { items: [], total: 0, offset: 0, limit: 1 },
		});

		renderBell();

		expect(await screen.findByLabelText("通知")).toBeInTheDocument();
		expect(screen.queryByText("0")).not.toBeInTheDocument();
	});
});
