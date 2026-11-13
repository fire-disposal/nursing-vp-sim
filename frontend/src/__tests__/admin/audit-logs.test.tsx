import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/__tests__/render";
import AuditLogsPage from "@/pages/ops/AuditLogsPage";

vi.mock("@/api/admin/audit-logs", () => ({
	getAuditLogs: vi.fn().mockResolvedValue({
		data: {
			items: [
				{
					id: 1,
					created_at: "2026-11-13T06:00:00Z",
					actor_id: 1,
					actor_username: "admin",
					actor_display_name: "管理员",
					actor_persona: "platform",
					action: "auth.login_succeeded",
					target_type: "session",
					target_id: "1",
					target_label: "admin",
					outcome: "success",
					payload: {},
					error_detail: null,
					request_id: "req-success",
					ip: null,
					request_method: "POST",
					request_path: "/api/auth/login",
					response_status: 200,
				},
			],
			total: 1,
			offset: 0,
			limit: 50,
		},
	}),
}));

describe("审计日志详情", () => {
	it("成功记录也展示对象、真实请求与自动记录的 HTTP 状态", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<AuditLogsPage />
				</MemoryRouter>
			</QueryClientProvider>,
		);
		const user = userEvent.setup();

		const request = await screen.findByText("POST /api/auth/login");
		const table = screen.getByRole("table");
		expect(within(table).getByText("登录会话")).toBeInTheDocument();
		expect(within(table).getByText("成功")).toBeInTheDocument();
		await user.hover(request);
		expect(await screen.findByText(/HTTP 200/)).toBeInTheDocument();
		expect(screen.getByText(/无附加业务字段/)).toBeInTheDocument();
	});
});
