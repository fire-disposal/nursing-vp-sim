import userEvent from "@testing-library/user-event";
import { render, screen } from "@/__tests__/render";
import { beforeEach, describe, expect, it } from "vitest";
import InquiryTool from "@/components/training/tools/InquiryTool";
import { InquiryProgressChip } from "@/components/training/InquiryProgressChip";
import { createMessageBus } from "@/engine/MessageBus";
import { useTrainingStore } from "@/stores/trainingStore";

const INQUIRIES = ["胸闷持续时间与诱因", "既往心脏病史", "吸烟史"];

/** 只命中第一项（“胸闷” bigram）。 */
const STUDENT_MESSAGE = { id: "m1", role: "student" as const, content: "请问胸闷多久了" };

function setStore(mode: string, messages: Array<Record<string, unknown>>) {
	useTrainingStore.setState({
		bus: createMessageBus(),
		recordDetail: { required_inquiries: INQUIRIES, mode } as never,
		messages: messages as never,
	});
}

beforeEach(() => {
	useTrainingStore.getState().reset();
});

describe("问诊任务清单", () => {
	it("按关键词命中标记已覆盖项，并显示完成度", () => {
		setStore("guided", [STUDENT_MESSAGE]);
		render(
			<InquiryTool
				bus={createMessageBus()}
				recordId="1"
				recordDetail={{ required_inquiries: INQUIRIES, mode: "guided" } as never}
			/>,
		);

		expect(screen.getByText("1/3")).toBeInTheDocument();
		expect(screen.getByText("胸闷持续时间与诱因")).toHaveStyle({ textDecoration: "line-through" });
		expect(screen.getByText("既往心脏病史")).not.toHaveStyle({ textDecoration: "line-through" });
	});

	it("病例未配置清单时给出空态而不是空列表", () => {
		render(
			<InquiryTool bus={createMessageBus()} recordId="1" recordDetail={{ required_inquiries: [] } as never} />,
		);

		expect(screen.getByText("该病例未配置问诊清单")).toBeInTheDocument();
	});

	it("状态栏清单入口显示完成度，点击后打开清单面板", async () => {
		setStore("guided", [STUDENT_MESSAGE]);
		let opened: Record<string, unknown> | null = null;
		useTrainingStore.getState().bus?.on("tool:open", (payload: Record<string, unknown>) => {
			opened = payload;
		});

		render(<InquiryProgressChip />);
		const chip = screen.getByTitle(/问诊任务清单 1\/3/);
		await userEvent.click(chip);

		expect(opened).toEqual({ id: "inquiry" });
	});

	it("独立考核不出现清单入口", () => {
		setStore("assessment", [STUDENT_MESSAGE]);
		render(<InquiryProgressChip />);

		expect(screen.queryByTitle(/问诊任务清单/)).toBeNull();
	});
});
