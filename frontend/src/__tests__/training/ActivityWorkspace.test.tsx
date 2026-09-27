import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeActivity, makeManifest } from "@/__tests__/fixtures/manifest";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import { cleanup, fireEvent, render, screen } from "@/__tests__/render";
import { ActivityRail } from "@/components/training/workspace/ActivityRail";
import { CompletionChecklist, CompletionStrip } from "@/components/training/workspace/CompletionStatus";
import type { SessionManifest } from "@/engine/manifest";
import { useTrainingStore } from "@/stores/trainingStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const bus = { on: vi.fn(() => () => {}), emit: vi.fn(), off: vi.fn(), listEvents: vi.fn(() => []) };

/** manifest 是服务端事实：测试把它放进原始 record（RQ 返回值）再渲染。 */
function setSession(manifest: SessionManifest, record?: Parameters<typeof makeRecord>[0]) {
	useTrainingStore.setState({
		bus: bus as never,
		recordId: "1",
		trainingEnded: false,
	});
	return makeRecord({ mode: "guided", required_inquiries: [], manifest: { ...manifest }, ...record });
}

beforeEach(() => {
	useWorkspaceStore.getState().resetWorkspace();
});

afterEach(() => {
	cleanup();
	useTrainingStore.getState().reset();
	useWorkspaceStore.getState().resetWorkspace();
});

describe("ActivityRail（manifest 驱动的可达性）", () => {
	it("只渲染服务端标为 available 的 activity，且用 manifest 的 label", () => {
		const manifest = makeManifest({
			activities: [
				makeActivity("nursing_record", {
					label: "护理记录",
					artifact_kind: "nursing_record",
					ui: { renderer: "nursing_record", placement: "side_panel", order: 10 },
				}),
				makeActivity("physical_exam", { label: "床旁检查", ui: { renderer: "physical_exam", placement: "side_panel", order: 20 } }),
				makeActivity("quiz", {
					label: "随堂测验",
					availability: { state: "unavailable", reason_code: "case_not_configured" },
				}),
			],
			artifacts: { nursing_record: { required: true, state: "draft", submitted_at: null, updated_at: null } },
		});

		render(withTrainingData(<ActivityRail />, setSession(manifest)));

		expect(screen.getByLabelText("护理记录（草稿未提交）")).toBeInTheDocument();
		expect(screen.getByLabelText("床旁检查")).toBeInTheDocument();
		// 病例未配置的 activity 不进导航（「配置了但不可达」由服务端在发布期拦截）
		expect(screen.queryByLabelText(/随堂测验/)).toBeNull();
	});

	it("点击导航项展开面板，未注册 renderer 时显式报错而不是静默消失", () => {
		const manifest = makeManifest({
			activities: [
				makeActivity("mystery", { label: "未知能力", ui: { renderer: "not_registered", placement: "side_panel", order: 10 } }),
			],
		});

		render(withTrainingData(<ActivityRail />, setSession(manifest)));
		fireEvent.click(screen.getByLabelText("未知能力"));

		expect(useWorkspaceStore.getState().openPanelId).toBe("mystery");
		expect(screen.getByText("未知能力暂无可用的界面组件")).toBeInTheDocument();
	});

	it("没有任何可用 activity 时不占位（对话区保持全宽）", () => {
		const manifest = makeManifest({ activities: [makeActivity("quiz", { availability: { state: "unavailable", reason_code: "case_not_configured" } })] });

		const { container } = render(withTrainingData(<ActivityRail />, setSession(manifest)));

		expect(container.querySelector("nav")).toBeNull();
	});

	it("产物状态在侧栏可见，不只在 tooltip 里（草稿/未填写）", () => {
		const manifest = makeManifest({
			activities: [
				makeActivity("nursing_record", {
					label: "护理记录",
					artifact_kind: "nursing_record",
					ui: { renderer: "nursing_record", placement: "side_panel", order: 10 },
				}),
				makeActivity("nursing_diagnosis", {
					label: "护理诊断",
					artifact_kind: "nursing_diagnosis",
					ui: { renderer: "nursing_diagnosis", placement: "side_panel", order: 20 },
				}),
			],
			artifacts: {
				nursing_record: { required: true, state: "draft", submitted_at: null, updated_at: null },
				nursing_diagnosis: { required: true, state: "empty", submitted_at: null, updated_at: null },
			},
		});

		render(withTrainingData(<ActivityRail />, setSession(manifest)));

		expect(screen.getByText("草稿")).toBeInTheDocument();
		expect(screen.getByText("未填写")).toBeInTheDocument();
	});

	it("引导提示存在时内置面板叫「引导提示」，否则沿用「问诊清单」", () => {
		const manifest = makeManifest({ activities: [] });
		const extras = { guided_hints: [{ clue_id: "c1", domain: "诱因", significance: "决定处置优先级" }] };

		const withHints = render(withTrainingData(<ActivityRail />, setSession(manifest, extras)));
		expect(screen.getByLabelText("引导提示")).toBeInTheDocument();
		withHints.unmount();

		render(
			withTrainingData(
				<ActivityRail />,
				setSession(manifest, { required_inquiries: ["胸闷持续时间与诱因"] }),
			),
		);
		expect(screen.getByLabelText("问诊清单")).toBeInTheDocument();
	});
});

describe("CompletionStrip（只用服务端 completion）", () => {
	it("原样展示服务端 blocker，并可跳到对应面板", () => {
		const manifest = makeManifest({
			activities: [
				makeActivity("nursing_record", {
					label: "护理记录",
					artifact_kind: "nursing_record",
					ui: { renderer: "nursing_record", placement: "side_panel", order: 10 },
				}),
			],
			artifacts: { nursing_record: { required: true, state: "empty", submitted_at: null, updated_at: null } },
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
			actions: [{ id: "complete_session", label: "结束训练", enabled: false }],
		});

		render(withTrainingData(<CompletionStrip />, setSession(manifest)));

		expect(screen.getByText("请先提交护理记录，再结束训练")).toBeInTheDocument();
		fireEvent.click(screen.getByText("去处理"));
		expect(useWorkspaceStore.getState().openPanelId).toBe("nursing_record");
	});

	it("服务端 eligible 时给出可结束提示", () => {
		const manifest = makeManifest({
			completion: {
				eligible: true,
				conditions: [{ id: "nursing_record_submitted", label: "提交护理记录", satisfied: true }],
				blockers: [],
			},
		});

		render(withTrainingData(<CompletionStrip />, setSession(manifest)));

		expect(screen.getByText("完成条件已满足，可结束训练")).toBeInTheDocument();
	});
});

describe("CompletionChecklist（结束确认弹窗内的交卷清单）", () => {
	/** 一份「护理记录未提交」的 blocker manifest；`activities` 决定能否定位落点。 */
	function blockedManifest(
		blockers: SessionManifest["completion"]["blockers"],
		withNursingActivity = true,
	) {
		return makeManifest({
			activities: withNursingActivity
				? [
						makeActivity("nursing_record", {
							label: "护理记录",
							artifact_kind: "nursing_record",
							ui: { renderer: "nursing_record", placement: "side_panel", order: 10 },
						}),
					]
				: [],
			artifacts: { nursing_record: { required: true, state: "empty", submitted_at: null, updated_at: null } },
			completion: {
				eligible: false,
				conditions: [{ id: "nursing_record_submitted", label: "提交护理记录", satisfied: false }],
				blockers,
			},
			actions: [{ id: "complete_session", label: "结束训练", enabled: false }],
		});
	}

	const notSubmitted = {
		code: "ARTIFACT_NOT_SUBMITTED",
		message: "请先提交护理记录，再结束训练",
		target: { type: "artifact", id: "nursing_record" },
	};

	it("「去处理」不仅打开面板，还通知宿主收起弹窗（否则面板被弹窗压住＝没跳成）", () => {
		const onNavigated = vi.fn();
		render(
			withTrainingData(
				<CompletionChecklist onNavigated={onNavigated} />,
				setSession(blockedManifest([notSubmitted])),
			),
		);

		fireEvent.click(screen.getByText("去处理"));

		expect(useWorkspaceStore.getState().openPanelId).toBe("nursing_record");
		expect(onNavigated).toHaveBeenCalledTimes(1);
	});

	it("blocker 带 target 但本端定位不到落点时给手动提示，不给假按钮", () => {
		render(withTrainingData(<CompletionChecklist />, setSession(blockedManifest([notSubmitted], false))));

		expect(screen.getByText("请先提交护理记录，再结束训练")).toBeInTheDocument();
		expect(screen.queryByText("去处理")).toBeNull();
		expect(screen.getByText("未能定位到对应面板，请手动打开处理")).toBeInTheDocument();
	});

	it("target 为空时不给任何动作（服务端文案自足，例如训练已结束）", () => {
		const manifest = blockedManifest([
			{ code: "SESSION_NOT_ACTIVE", message: "训练已结束，无法再次提交完成", target: null },
		]);
		render(withTrainingData(<CompletionChecklist />, setSession(manifest)));

		expect(screen.getByText("训练已结束，无法再次提交完成")).toBeInTheDocument();
		expect(screen.queryByText("去处理")).toBeNull();
		expect(screen.queryByText(/手动打开/)).toBeNull();
	});
});
