import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/__tests__/render";
import { Composer } from "@/components/training/clinical-reasoning/Composer";
import {
	type ClinicalSendError,
	SAFETY_BLOCKED_CODE,
} from "@/components/training/clinical-reasoning/useClinicalReasoning";

const ORIGINAL = "你先别急，我想先了解一下你现在最难受的是什么。";

function sendError(overrides: Partial<ClinicalSendError> = {}): ClinicalSendError {
	return {
		message: "这次患者回复未通过安全检查，未加入对话。你的发言已保留，可修改后重新发送。",
		content: ORIGINAL,
		requestId: "req-1",
		retryMode: "rejected",
		code: SAFETY_BLOCKED_CODE,
		...overrides,
	};
}

describe("Composer 安全拦截体验", () => {
	it("红线拦截不提供原样重试，主操作是填入原话并修改", async () => {
		const onRetrySend = vi.fn();
		const onSend = vi.fn();
		render(
			<Composer
				sending={false}
				sendError={sendError()}
				locked={false}
				onSend={onSend}
				onRetrySend={onRetrySend}
			/>,
		);

		expect(screen.queryByRole("button", { name: "重试发送" })).toBeNull();
		const edit = screen.getByRole("button", { name: "填入原话并修改" });

		await userEvent.click(edit);

		// 原话回到草稿，且**没有**触发任何重试
		const textbox = screen.getByLabelText("对患者说的话") as HTMLTextAreaElement;
		await waitFor(() => expect(textbox.value).toBe(ORIGINAL));
		expect(onRetrySend).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
	});

	it("服务端文案优先：显示服务端给出的失败说明而不是网络错误", () => {
		render(
			<Composer
				sending={false}
				sendError={sendError()}
				locked={false}
				onSend={vi.fn()}
				onRetrySend={vi.fn()}
			/>,
		);
		expect(
			screen.getByText("这次患者回复未通过安全检查，未加入对话。你的发言已保留，可修改后重新发送。"),
		).toBeTruthy();
	});

	it("普通失败仍是重试发送，不影响原有行为", async () => {
		const onRetrySend = vi.fn();
		render(
			<Composer
				sending={false}
				sendError={sendError({ code: "chat.llm_unavailable", message: "患者回合未完成，请重试" })}
				locked={false}
				onSend={vi.fn()}
				onRetrySend={onRetrySend}
			/>,
		);

		expect(screen.queryByRole("button", { name: "填入原话并修改" })).toBeNull();
		await userEvent.click(screen.getByRole("button", { name: "重试发送" }));
		expect(onRetrySend).toHaveBeenCalledTimes(1);
	});
});
