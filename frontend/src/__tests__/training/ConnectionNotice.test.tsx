import { render, screen } from "@/__tests__/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionNotice } from "@/components/training/ChatArea";

/**
 * E5：状态归因必须准确 —— WS 只推评分/状态通知，对话走 SSE、工具走 HTTP。
 * WS 断开不得说成「工具不可用」；只有网络断开才影响全部通道。
 */

afterEach(() => {
	vi.restoreAllMocks();
});

describe("ConnectionNotice（只报告真正受损的能力）", () => {
	it("在线但 WS 断开：只说实时推送暂停，并说明对话与工具仍可用", () => {
		render(<ConnectionNotice />);

		const notice = screen.getByRole("status").textContent ?? "";
		expect(notice).toContain("实时推送连接中断");
		expect(notice).toContain("对话与工具仍可用");
		expect(notice).not.toContain("工具不可用");
	});

	it("网络断开：说明对话/工具/提交都会失败，而不是只怪 WS", () => {
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);

		render(<ConnectionNotice />);

		const notice = screen.getByRole("status").textContent ?? "";
		expect(notice).toContain("网络已断开");
		expect(notice).toContain("提交都会失败");
	});
});
