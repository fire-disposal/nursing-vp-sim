import { afterEach, describe, expect, it, vi } from "vitest";
import { makeActivity, makeManifest } from "@/__tests__/fixtures/manifest";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import case1Payload from "@/__tests__/fixtures/session-manifest.case1.json";
import { cleanup, render, screen } from "@/__tests__/render";
import { WelcomeScreen } from "@/components/training/WelcomeScreen";
import type { SessionManifest } from "@/engine/manifest";
import { useTrainingStore } from "@/stores/trainingStore";

/**
 * 开场屏要让学生不依赖口头指导就说出：要做什么、还缺什么、如何交卷、之后看什么。
 *
 * 因此这里断言的全是 manifest 事实：`requiredArtifacts` / `artifacts[].state` /
 * `completion.blockers` / `availableActivities`。manifest 没说的状态一律不出现——
 * 尤其是「还缺什么」只能来自服务端 blocker，不能由前端凭空声称。
 */

const PATIENT = {
	name: "王建国",
	age: 68,
	gender: "male" as const,
	caseTitle: "慢阻肺",
	chiefComplaint: "喘不上气",
};

const NURSING_RECORD = makeActivity("nursing_record", {
	label: "护理记录",
	artifact_kind: "nursing_record",
	commands: ["load", "save", "submit"],
	ui: { renderer: "nursing_record", placement: "side_panel", order: 10 },
});

const QUIZ_UNAVAILABLE = makeActivity("quiz", {
	label: "随堂测验",
	availability: { state: "unavailable", reason_code: "case_not_configured" },
	ui: { renderer: "quiz", placement: "side_panel", order: 30 },
});

const BLOCKER = {
	code: "ARTIFACT_NOT_SUBMITTED",
	message: "请先提交护理记录，再结束训练",
	target: { type: "artifact", id: "nursing_record" },
};

const PHYSICAL_EXAM = makeActivity("physical_exam", {
	label: "床旁检查",
	evidence_kind: "exam_results",
	ui: { renderer: "physical_exam", placement: "side_panel", order: 20 },
});

function renderWelcome(manifest: SessionManifest, overrides: Parameters<typeof makeRecord>[0] = {}) {
	return render(
		withTrainingData(
			<WelcomeScreen patient={PATIENT} onQuickPrompt={vi.fn()} />,
			makeRecord({ mode: "guided", manifest: { ...manifest }, ...overrides }),
		),
	);
}

afterEach(() => {
	cleanup();
	useTrainingStore.getState().reset();
});

describe("开场屏：角色、产物、交卷与复盘路径", () => {
	it("必交产物与 blocker 齐备时：标出「必交」与产物名，说明缺什么，并给出结束后路径", () => {
		renderWelcome(
			makeManifest({
				activities: [NURSING_RECORD, QUIZ_UNAVAILABLE],
				artifacts: {
					nursing_record: { required: true, state: "empty", submitted_at: null, updated_at: null },
				},
				completion: {
					eligible: false,
					conditions: [{ id: "nursing_record_submitted", label: "提交护理记录", satisfied: false }],
					blockers: [BLOCKER],
				},
			}),
		);

		// ① 你的角色
		expect(screen.getByText(/先与患者对话采集病史/)).toBeInTheDocument();

		// ② 本病例要求你交的产物（来自 requiredArtifacts + artifacts[].state）
		expect(screen.getByText("必交")).toBeInTheDocument();
		expect(screen.getByText("护理记录")).toBeInTheDocument();
		expect(screen.getByText("未填写")).toBeInTheDocument();
		expect(screen.getByText(/本病例要求提交的产物/)).toBeInTheDocument();
		expect(screen.getByText(/护理记录（未填写）/)).toBeInTheDocument();

		// 不可用活动给出服务端原因，且不混进流程步骤
		expect(screen.getByText("本次不可用：随堂测验（本病例未配置）")).toBeInTheDocument();

		// ③ 还缺什么 = 服务端 blocker 原文
		expect(screen.getByText("还缺什么")).toBeInTheDocument();
		expect(screen.getByText("请先提交护理记录，再结束训练")).toBeInTheDocument();

		// ④ 如何交卷 + 结束后会看到什么
		expect(screen.getByText("「结束训练」")).toBeInTheDocument();
		expect(screen.getByText(/条件没满足时会被拦下/)).toBeInTheDocument();
		expect(screen.getByText(/关键选择回看/)).toBeInTheDocument();
		expect(screen.getByText(/逐项判定与证据/)).toBeInTheDocument();
		expect(screen.getByText(/反馈问卷/)).toBeInTheDocument();
	});

	it("无可-blocker 的 manifest：不出现「还缺什么」，也不显示任何未完成状态", () => {
		renderWelcome(
			makeManifest({
				activities: [NURSING_RECORD],
				artifacts: {
					nursing_record: {
						required: true,
						state: "submitted",
						submitted_at: "2026-09-27T00:00:00+00:00",
						updated_at: null,
					},
				},
				completion: {
					eligible: true,
					conditions: [{ id: "nursing_record_submitted", label: "提交护理记录", satisfied: true }],
					blockers: [],
				},
			}),
		);

		expect(screen.queryByText("还缺什么")).toBeNull();
		expect(screen.queryByText(/请先提交/)).toBeNull();
		expect(screen.queryByText(/本次不可用/)).toBeNull();
		// 状态只来自 manifest.artifacts：服务端说已提交就是已提交
		expect(screen.getByText("已提交")).toBeInTheDocument();
		expect(screen.queryByText(/未提交|未填写|未完成/)).toBeNull();
		// 与状态无关的固定路径描述仍然在
		expect(screen.getByText("「结束训练」")).toBeInTheDocument();
		expect(screen.getByText(/关键选择回看/)).toBeInTheDocument();
	});

	it("草稿状态按服务端 artifacts[].state 说成「草稿未提交」，并提示草稿不算提交", () => {
		renderWelcome(
			makeManifest({
				activities: [NURSING_RECORD],
				artifacts: {
					nursing_record: {
						required: true,
						state: "draft",
						submitted_at: null,
						updated_at: "2026-09-27T00:00:00+00:00",
					},
				},
				completion: {
					eligible: false,
					conditions: [{ id: "nursing_record_submitted", label: "提交护理记录", satisfied: false }],
					blockers: [BLOCKER],
				},
			}),
		);

		expect(screen.getByText("草稿未提交")).toBeInTheDocument();
		expect(screen.getByText(/草稿不算提交/)).toBeInTheDocument();
	});

	it("建议开场只在引导模式出现（门控在 mode，不在 from_assignment）", () => {
		const manifest = makeManifest({
			activities: [NURSING_RECORD],
			artifacts: {
				nursing_record: { required: true, state: "empty", submitted_at: null, updated_at: null },
			},
		});

		renderWelcome(manifest);
		expect(screen.getByText("建议开场")).toBeInTheDocument();
		expect(screen.getByText("请跟我说说您的喘不上气是怎么回事")).toBeInTheDocument();

		cleanup();
		renderWelcome(manifest, { mode: "assessment", from_assignment: true });
		expect(screen.queryByText("建议开场")).toBeNull();
	});

	it("没有必交产物时：明确说「不要求提交」，不出现「必交」与「还缺什么」", () => {
		renderWelcome(
			makeManifest({
				activities: [PHYSICAL_EXAM],
				artifacts: {},
				completion: { eligible: true, conditions: [], blockers: [] },
			}),
		);

		expect(screen.getByText("本病例没有额外要求提交的产物。")).toBeInTheDocument();
		expect(screen.queryByText("必交")).toBeNull();
		expect(screen.queryByText("还缺什么")).toBeNull();
		expect(screen.getByText("床旁检查")).toBeInTheDocument();
	});

	it("真实 case1 后端载荷：必交产物、未填写状态与未配置原因同时呈现", () => {
		render(
			withTrainingData(
				<WelcomeScreen patient={PATIENT} onQuickPrompt={vi.fn()} />,
				makeRecord({ mode: "guided", manifest: { ...case1Payload } }),
			),
		);

		// 可用步骤来自 availableActivities：护理记录（必交，未填写）+ 床旁检查
		expect(screen.getByText("必交")).toBeInTheDocument();
		expect(screen.getByText("未填写")).toBeInTheDocument();
		expect(screen.getByText("床旁检查")).toBeInTheDocument();
		// 未配置的能力给出 reason_code 的中文原因，且不进入步骤编号
		expect(
			screen.getByText("本次不可用：随堂测验（本病例未配置）、护理诊断（本病例未配置）"),
		).toBeInTheDocument();
		// 缺什么就是服务端 blocker.message 原文
		expect(screen.getByText("请先提交护理记录，再结束训练")).toBeInTheDocument();
	});

	it("manifest 未下发时：不声称产物、状态或缺失项，只保留骨架步骤", () => {
		render(
			withTrainingData(
				<WelcomeScreen patient={PATIENT} onQuickPrompt={vi.fn()} />,
				makeRecord({ mode: "guided", manifest: null }),
			),
		);

		expect(screen.queryByText("必交")).toBeNull();
		expect(screen.queryByText("还缺什么")).toBeNull();
		expect(screen.queryByText(/本病例要求提交的产物/)).toBeNull();
		expect(screen.queryByText(/本病例没有额外要求提交的产物/)).toBeNull();
		expect(screen.queryByText("未填写")).toBeNull();

		expect(screen.getByText("问诊采集")).toBeInTheDocument();
		expect(screen.getByText("结束评分")).toBeInTheDocument();
		expect(screen.getByText("「结束训练」")).toBeInTheDocument();
		expect(screen.getByText(/关键选择回看/)).toBeInTheDocument();
	});
});
