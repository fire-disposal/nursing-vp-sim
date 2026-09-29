import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setViewport } from "@/__tests__/setup";
import { makeActivity, makeManifest } from "@/__tests__/fixtures/manifest";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import { cleanup, render, screen } from "@/__tests__/render";
import ActivityBar from "@/components/training/workspace/ActivityBar";
import { ActivityRail } from "@/components/training/workspace/ActivityRail";
import { useTrainingStore } from "@/stores/trainingStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * 工作区宿主选择的回归：**底部抽屉只属于竖屏**。
 *
 * 缺陷背景（2026-09-27）：宿主只按"宽度 < lg"决定，于是横屏（宽不够 lg、但横向有位置、
 * 右侧栏可用）也弹底部抽屉，把本来就不高的视口再切掉一半。
 */

const bus = { on: vi.fn(() => () => {}), emit: vi.fn(), off: vi.fn() };

function session() {
	useTrainingStore.setState({ bus: bus as never, recordId: "1", trainingEnded: false });
	return makeRecord({
		mode: "guided",
		required_inquiries: [],
			manifest: {
			...makeManifest({
				activities: [
					makeActivity("nursing_record", {
						label: "护理记录",
						artifact_kind: "nursing_record",
						ui: { renderer: "nursing_record", placement: "side_panel", order: 10 },
					}),
				],
				// 状态文本进按钮的无障碍名（草稿未提交）：与既有工作区测试保持同一夹具口径
				artifacts: {
					nursing_record: { required: true, state: "draft", submitted_at: null, updated_at: null },
				},
			}),
		},
	});
}

function renderBoth() {
	render(withTrainingData(
		<>
			<ActivityRail />
			<ActivityBar />
		</>,
		session(),
	));
}

beforeEach(() => {
	useWorkspaceStore.getState().resetWorkspace();
});

afterEach(() => {
	cleanup();
	useTrainingStore.getState().reset();
	useWorkspaceStore.getState().resetWorkspace();
	setViewport(1024, 768);
});

describe("工作区宿主：横屏用右侧栏、竖屏才用底部抽屉", () => {
	it("竖屏手机：底部抽屉（能力条可见），右侧栏不渲染", () => {
		setViewport(390, 844);
		renderBoth();
		expect(screen.getByLabelText("训练能力条")).toBeInTheDocument();
		expect(screen.queryByLabelText("训练能力侧栏")).toBeNull();
	});

	it("横屏手机：走右侧栏，不再弹底部抽屉", () => {
		setViewport(844, 390);
		renderBoth();
		expect(screen.queryByLabelText("训练能力条")).toBeNull();
		expect(screen.getByLabelText("训练能力侧栏")).toBeInTheDocument();
		expect(screen.getByLabelText("护理记录（草稿未提交）")).toBeInTheDocument();
	});

	it("横屏窄窗口（宽 < lg）：同样走右侧栏", () => {
		setViewport(1000, 600);
		renderBoth();
		expect(screen.queryByLabelText("训练能力条")).toBeNull();
		expect(screen.getByLabelText("训练能力侧栏")).toBeInTheDocument();
	});

	it("宽屏：右侧栏", () => {
		setViewport(1440, 900);
		renderBoth();
		expect(screen.queryByLabelText("训练能力条")).toBeNull();
		expect(screen.getByLabelText("护理记录（草稿未提交）")).toBeInTheDocument();
	});

	it("竖屏平板（宽 ≥ lg 之前）：仍是底部抽屉", () => {
		setViewport(820, 1180);
		renderBoth();
		expect(screen.getByLabelText("训练能力条")).toBeInTheDocument();
		expect(screen.queryByLabelText("训练能力侧栏")).toBeNull();
	});
});
