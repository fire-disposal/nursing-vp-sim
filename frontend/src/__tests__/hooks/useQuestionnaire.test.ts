import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";

/**
 * 问卷（U0 主结局）的状态机契约：三种情形必须严格分开，任何一种失败都不许静默。
 * 页面只按这里给出的 `status` 渲染，因此状态错判 = 学生看不到问卷，研究上被误判成「跳过了问卷」。
 */
const apiMock = vi.hoisted(() => ({
	checkQuestionnaire: vi.fn(),
	submitQuestionnaire: vi.fn(),
}));

vi.mock("@/api/questionnaires", () => ({
	checkQuestionnaire: apiMock.checkQuestionnaire,
	submitQuestionnaire: apiMock.submitQuestionnaire,
}));

const NO_PENDING = {
	has_pending: false,
	is_required: false,
	trigger_event: "after_scoring",
};

/** 服务端说有待答，但模板已被删除/取不到：template_id 在、template 为 null */
const PENDING_NO_TEMPLATE = {
	has_pending: true,
	template_id: 9,
	template: null,
	is_required: true,
	trigger_event: "after_scoring",
};

/** 服务端说有待答，但连 template_id 都没有：提交绝不能静默吞掉 */
const PENDING_NO_TEMPLATE_ID = {
	has_pending: true,
	template_id: null,
	template: null,
	is_required: true,
	trigger_event: "after_scoring",
};

const PENDING_READY = {
	...PENDING_NO_TEMPLATE,
	template: {
		id: 9,
		title: "训练后反馈",
		description: null,
		is_active: true,
		question_count: 1,
		response_count: 0,
		questions: [
			{
				id: 91,
				content: "本次训练是否有帮助？",
				question_type: "short_text",
				required: true,
				sort_order: 1,
				options: null,
			},
		],
	},
};

function setup(onComplete?: () => void) {
	return renderHook(() =>
		useQuestionnaire({
			caseId: 1,
			recordId: 7,
			trigger: "after_scoring",
			onComplete,
		}),
	);
}

async function runCheck(check: () => Promise<unknown>) {
	await act(async () => {
		await check();
	});
}

beforeEach(() => {
	apiMock.checkQuestionnaire.mockResolvedValue({ data: NO_PENDING });
	apiMock.submitQuestionnaire.mockResolvedValue({ data: {} });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("useQuestionnaire 状态判定", () => {
	it("状态①：无待答 → none（页面据此不显示任何问卷提示）", async () => {
		const { result } = setup();
		expect(result.current.status).toBe("idle");

		await runCheck(result.current.check);

		expect(result.current.status).toBe("none");
		expect(result.current.shouldShow).toBe(false);
	});

	it("状态②：有待答且题目已就绪 → ready", async () => {
		apiMock.checkQuestionnaire.mockResolvedValue({ data: PENDING_READY });
		const { result } = setup();

		await runCheck(result.current.check);

		expect(result.current.status).toBe("ready");
		expect(result.current.shouldShow).toBe(true);
	});

	it("状态③：有待答但题目拿不到 → template_unavailable（不是 none，也不是 ready）", async () => {
		apiMock.checkQuestionnaire.mockResolvedValue({ data: PENDING_NO_TEMPLATE });
		const { result } = setup();

		await runCheck(result.current.check);

		expect(result.current.status).toBe("template_unavailable");
		// 「有待答」语义不变：before_training 流程靠 shouldShow 决定是否暂停并挡住场景
		expect(result.current.shouldShow).toBe(true);
	});

	it("已跳过（dismiss）后回到 none：不能因为跳过反而报「加载失败」", async () => {
		apiMock.checkQuestionnaire.mockResolvedValue({ data: PENDING_READY });
		const { result } = setup();
		await runCheck(result.current.check);

		act(() => {
			result.current.dismiss();
		});

		expect(result.current.shouldShow).toBe(false);
		expect(result.current.status).toBe("none");
	});
});

describe("useQuestionnaire check 失败", () => {
	it("check 请求失败 → check_failed（不静默），下一次成功即恢复", async () => {
		apiMock.checkQuestionnaire.mockRejectedValueOnce(new Error("network"));
		const { result } = setup();

		await runCheck(result.current.check);
		expect(result.current.status).toBe("check_failed");

		apiMock.checkQuestionnaire.mockResolvedValueOnce({ data: NO_PENDING });
		await runCheck(result.current.check);
		expect(result.current.status).toBe("none");
	});

	it("check 失败不会拆掉已经就绪的问卷（保留上一次成功结果）", async () => {
		apiMock.checkQuestionnaire.mockResolvedValueOnce({ data: PENDING_READY });
		const { result } = setup();
		await runCheck(result.current.check);
		expect(result.current.status).toBe("ready");

		apiMock.checkQuestionnaire.mockRejectedValueOnce(new Error("network"));
		await runCheck(result.current.check);

		expect(result.current.status).toBe("ready");
		expect(result.current.checkResponse?.template_id).toBe(9);
	});
});

describe("useQuestionnaire 提交", () => {
	it("缺 template_id 时 submit 抛错，而不是静默返回", async () => {
		apiMock.checkQuestionnaire.mockResolvedValueOnce({ data: PENDING_NO_TEMPLATE_ID });
		const { result } = setup();
		await runCheck(result.current.check);

		await act(async () => {
			await expect(
				result.current.submit([{ question_id: 91, answer_value: "有" }]),
			).rejects.toThrow(/问卷题目未加载/);
		});

		expect(apiMock.submitQuestionnaire).not.toHaveBeenCalled();
	});

	it("提交失败向上抛（调用方据此显示失败并保持弹窗），在途标志复位", async () => {
		const onComplete = vi.fn();
		apiMock.checkQuestionnaire.mockResolvedValueOnce({ data: PENDING_READY });
		apiMock.submitQuestionnaire.mockRejectedValueOnce(new Error("500"));
		const { result } = setup(onComplete);
		await runCheck(result.current.check);

		await act(async () => {
			await expect(
				result.current.submit([{ question_id: 91, answer_value: "有" }]),
			).rejects.toThrow(/500/);
		});

		expect(result.current.isSubmitting).toBe(false);
		expect(onComplete).not.toHaveBeenCalled();
	});

	it("提交成功后回调 onComplete（调用方据此重新 check）", async () => {
		const onComplete = vi.fn();
		apiMock.checkQuestionnaire.mockResolvedValueOnce({ data: PENDING_READY });
		const { result } = setup(onComplete);
		await runCheck(result.current.check);

		await act(async () => {
			await result.current.submit([{ question_id: 91, answer_value: "有" }]);
		});

		expect(apiMock.submitQuestionnaire).toHaveBeenCalledWith({
			template_id: 9,
			case_id: 1,
			record_id: 7,
			answers: [{ question_id: 91, answer_value: "有" }],
		});
		expect(onComplete).toHaveBeenCalledTimes(1);
	});
});
