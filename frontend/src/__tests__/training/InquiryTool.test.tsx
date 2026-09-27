import userEvent from "@testing-library/user-event";
import { render, screen } from "@/__tests__/render";
import { beforeEach, describe, expect, it } from "vitest";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import InquiryTool from "@/components/training/tools/InquiryTool";
import { InquiryProgressChip } from "@/components/training/InquiryProgressChip";
import { createMessageBus } from "@/engine/MessageBus";
import { useTrainingStore } from "@/stores/trainingStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const INQUIRIES = ["胸闷持续时间与诱因", "既往心脏病史", "吸烟史"];

/** 蓝图给出的引导提示（领域 + 评估意义），服务端只在引导模式下发。 */
const HINTS = [
	{ clue_id: "clue-1", domain: "诱因与缓解因素", significance: "区分心源性与肺源性，决定是否需要立即上报", source: "patient" },
	{ clue_id: "clue-2", domain: "用药依从情况", significance: "决定后续护理评估的基线", source: "patient" },
];

/** 只命中第一项（“胸闷” bigram）。 */
const STUDENT_MESSAGE = { id: "m1", role: "student" as const, content: "请问胸闷多久了" };

/** 面板只从原始 record 读病例事实（不再经 store 复制）。 */
function recordWith(mode: string, requiredInquiries: string[] = INQUIRIES) {
	return makeRecord({ mode, required_inquiries: requiredInquiries });
}

function recordWithHints(mode = "guided") {
	return makeRecord({ mode, required_inquiries: INQUIRIES, guided_hints: HINTS });
}

function setMessages(messages: Array<Record<string, unknown>>) {
	useTrainingStore.setState({
		bus: createMessageBus(),
		messages: messages as never,
	});
}

beforeEach(() => {
	useTrainingStore.getState().reset();
});

describe("问诊任务清单", () => {
	it("按关键词命中标记已覆盖项，并显示完成度", () => {
		setMessages([STUDENT_MESSAGE]);
		render(
			withTrainingData(
				<InquiryTool />,
				recordWith("guided"),
			),
		);

		expect(screen.getByText("1/3")).toBeInTheDocument();
		expect(screen.getByText("胸闷持续时间与诱因")).toHaveStyle({ textDecoration: "line-through" });
		expect(screen.getByText("既往心脏病史")).not.toHaveStyle({ textDecoration: "line-through" });
	});

	it("病例未配置清单时给出空态而不是空列表", () => {
		render(
			withTrainingData(
				<InquiryTool />,
				recordWith("guided", []),
			),
		);

		expect(screen.getByText("该病例未配置问诊清单")).toBeInTheDocument();
	});

	it("状态栏清单入口显示完成度，点击后打开清单面板", async () => {
		setMessages([STUDENT_MESSAGE]);
		useWorkspaceStore.setState({ openPanelId: null });

		render(withTrainingData(<InquiryProgressChip />, recordWith("guided")));
		const chip = screen.getByTitle(/问诊任务清单 1\/3/);
		await userEvent.click(chip);

		expect(useWorkspaceStore.getState().openPanelId).toBe("inquiry");
	});

	it("独立考核不出现清单入口", () => {
		setMessages([STUDENT_MESSAGE]);
		render(withTrainingData(<InquiryProgressChip />, recordWith("assessment")));

		expect(screen.queryByTitle(/问诊任务清单/)).toBeNull();
	});
});

describe("引导提示（docs/19 §3.3：领域 + 意义，不是清单）", () => {
	it("有 guided_hints 时给领域与评估意义，而不是关键词清单与完成度", () => {
		setMessages([STUDENT_MESSAGE]);
		render(withTrainingData(<InquiryTool />, recordWithHints()));

		expect(screen.getByText("诱因与缓解因素")).toBeInTheDocument();
		expect(screen.getByText("区分心源性与肺源性，决定是否需要立即上报")).toBeInTheDocument();
		expect(screen.getByText("用药依从情况")).toBeInTheDocument();
		// 提示不是可勾选的清单：不出现进度、不出现关键词自检的勾选态
		expect(screen.queryByText("1/3")).toBeNull();
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(screen.queryByText("问诊任务清单（关键词自检）")).toBeNull();
		expect(screen.queryByText("胸闷持续时间与诱因")).toBeNull();
	});

	it("guided_hints 为空时回落到既有清单（含关键词自检与完成度）", () => {
		setMessages([STUDENT_MESSAGE]);
		render(withTrainingData(<InquiryTool />, recordWith("guided")));

		expect(screen.getByText("问诊任务清单（关键词自检）")).toBeInTheDocument();
		expect(screen.getByText("1/3")).toBeInTheDocument();
	});

	it("独立考核/盲盒即使收到提示数据也不展示", () => {
		setMessages([STUDENT_MESSAGE]);
		render(withTrainingData(<InquiryTool />, recordWithHints("assessment")));

		expect(screen.queryByText("诱因与缓解因素")).toBeNull();
		expect(screen.queryByText("问诊任务清单（关键词自检）")).toBeNull();
		expect(screen.getByText("本次训练不提供问诊提示")).toBeInTheDocument();
	});

	it("状态栏入口只说提示条数，不显示清单完成度", async () => {
		setMessages([STUDENT_MESSAGE]);
		useWorkspaceStore.setState({ openPanelId: null });

		render(withTrainingData(<InquiryProgressChip />, recordWithHints()));
		const chip = screen.getByTitle(/引导提示 2 条/);

		expect(screen.queryByTitle(/问诊任务清单/)).toBeNull();
		expect(screen.queryByText(/清单 \d\/\d/)).toBeNull();

		await userEvent.click(chip);
		expect(useWorkspaceStore.getState().openPanelId).toBe("inquiry");
	});
});
