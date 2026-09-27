import { afterEach, describe, expect, it, vi } from "vitest";
import { makeActivity, makeManifest } from "@/__tests__/fixtures/manifest";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import { cleanup, render, screen } from "@/__tests__/render";
import { ChatArea } from "@/components/training/ChatArea";
import { useTrainingStore } from "@/stores/trainingStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * 对话列不得自带顶部退避。
 *
 * 缺陷背景（2026-09-27）：`TrainingEngine` 已给主容器让出顶栏高度，`ChatArea` 又给对话列
 * 叠了一次内联 `paddingTop`，竖屏 88px / 横屏 72px 被两次吃掉，且对话列比患者列低一个顶栏，
 * 开场卡在 390x844 / 844x390 被挤到几乎不可读。
 */

const bus = { on: vi.fn(() => () => {}), emit: vi.fn(), off: vi.fn(), listEvents: vi.fn(() => []) };

const NURSING_RECORD = makeActivity("nursing_record", {
	label: "护理记录",
	artifact_kind: "nursing_record",
	ui: { renderer: "nursing_record", placement: "side_panel", order: 10 },
});

function session() {
	useTrainingStore.setState({
		bus: bus as never,
		recordId: "1",
		trainingEnded: false,
		messages: [],
	});
	return makeRecord({
		mode: "guided",
		manifest: {
			...makeManifest({
				activities: [NURSING_RECORD],
				artifacts: {
					nursing_record: { required: true, state: "empty", submitted_at: null, updated_at: null },
				},
				completion: {
					eligible: false,
					conditions: [{ id: "nursing_record_submitted", label: "提交护理记录", satisfied: false }],
					blockers: [
						{
							code: "ARTIFACT_NOT_SUBMITTED",
							message: "请先提交护理记录，再结束训练",
							target: { type: "artifact", id: "nursing_record" },
						},
					],
				},
			}),
		},
	});
}

afterEach(() => {
	cleanup();
	useTrainingStore.getState().reset();
	useWorkspaceStore.getState().resetWorkspace();
});

describe("对话列布局与首帧开场", () => {
	it("对话列不再自加顶部内边距（顶部退避只由 TrainingEngine 一层负责）", () => {
		const { container } = render(
			withTrainingData(
				<ChatArea onSend={vi.fn()} onCorrectLast={vi.fn()} />,
				session(),
			),
		);

		const column = container.firstElementChild as HTMLElement;
		expect(column.style.paddingTop).toBe("");
	});

	it("首帧直接给出 manifest 驱动的开场（必交产物与缺什么）", () => {
		render(withTrainingData(<ChatArea onSend={vi.fn()} onCorrectLast={vi.fn()} />, session()));

		expect(screen.getByText("必交")).toBeInTheDocument();
		expect(screen.getByText("还缺什么")).toBeInTheDocument();
		// 开场与对话区上方的完成条同口径：同一句服务端 blocker 文案在两处出现
		expect(screen.getAllByText("请先提交护理记录，再结束训练")).toHaveLength(2);
	});
});
