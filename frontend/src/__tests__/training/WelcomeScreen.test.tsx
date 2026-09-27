import { afterEach, describe, expect, it, vi } from "vitest";
import { makeActivity, makeManifest } from "@/__tests__/fixtures/manifest";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";
import { cleanup, render, screen } from "@/__tests__/render";
import { WelcomeScreen } from "@/components/training/WelcomeScreen";
import type { SessionManifest } from "@/engine/manifest";
import { useTrainingStore } from "@/stores/trainingStore";

/**
 * 开场是**任务卡**，不是说明书：只说「你是谁 / 要走哪几步 / 现在缺什么 / 可选的开场问句」。
 *
 * 「要交的产物明细 / 如何交卷 / 结束后看什么」搬进了完成清单弹窗（动作时才需要），
 * 因此这里同时钉住"开场不再复述流程"——信息只有一处，避免又长回一屏说明文字。
 * 所有状态来自 manifest（`requiredArtifacts` / `artifacts[].state` / `completion.blockers`），
 * manifest 没说的状态一律不出现。
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

const PHYSICAL_EXAM = makeActivity("physical_exam", {
	label: "床旁检查",
	evidence_kind: "exam_results",
	ui: { renderer: "physical_exam", placement: "side_panel", order: 20 },
});

const QUIZ_UNAVAILABLE = makeActivity("quiz", {
	label: "随堂测验",
	availability: { state: "unavailable", reason_code: "case_not_configured" },
	ui: { renderer: "quiz", placement: "side_panel", order: 30 },
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

describe("开场任务卡：角色、步骤、缺什么", () => {
	it("角色一行 + 步骤芯片（含必交与产物状态）+ 服务端 blocker", () => {
		const manifest = makeManifest({
			activities: [NURSING_RECORD, PHYSICAL_EXAM, QUIZ_UNAVAILABLE],
			artifacts: {
				nursing_record: { state: "empty", required: true, submitted_at: null, updated_at: null },
			},
			completion: {
				eligible: false,
				conditions: [{ id: "artifact_submitted", label: "已提交护理记录", satisfied: false }],
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
		renderWelcome(manifest);

		expect(screen.getByText(/先与患者对话采集病史/)).toBeInTheDocument();
		for (const step of ["问诊采集", "护理记录", "床旁检查", "结束评分"]) {
			expect(screen.getByText(step)).toBeInTheDocument();
		}
		expect(screen.getByText("必交")).toBeInTheDocument();
		expect(screen.getByText("未填写")).toBeInTheDocument();
		expect(screen.getByText("本次不可用：随堂测验（本病例未配置）")).toBeInTheDocument();
		expect(screen.getByText("请先提交护理记录，再结束训练")).toBeInTheDocument();
	});

	it("开场不复述流程：产物明细与复盘路径只在完成清单里", () => {
		renderWelcome(
			makeManifest({
				activities: [NURSING_RECORD],
				artifacts: {
					nursing_record: { state: "empty", required: true, submitted_at: null, updated_at: null },
				},
			}),
		);

		expect(screen.queryByText(/本病例要求提交的产物/)).toBeNull();
		expect(screen.queryByText(/关键选择回看/)).toBeNull();
		expect(screen.queryByText(/草稿不算提交/)).toBeNull();
	});

	it("manifests 未下发时只有骨架步骤，不声称任何产物状态", () => {
		render(
			withTrainingData(<WelcomeScreen patient={PATIENT} onQuickPrompt={vi.fn()} />, makeRecord({ manifest: null })),
		);

		expect(screen.getByText("问诊采集")).toBeInTheDocument();
		expect(screen.getByText("结束评分")).toBeInTheDocument();
		expect(screen.queryByText("必交")).toBeNull();
		expect(screen.queryByText(/失败|未填写|草稿/)).toBeNull();
	});

	it("建议开场只在引导模式出现", () => {
		renderWelcome(makeManifest(), { mode: "guided" });
		expect(screen.getByText("建议开场")).toBeInTheDocument();
		expect(screen.getByText(/喘不上气是怎么回事/)).toBeInTheDocument();
	});

	it("独立/盲盒模式不给建议开场", () => {
		renderWelcome(makeManifest(), { mode: "blind_box" });
		expect(screen.queryByText("建议开场")).toBeNull();
		expect(screen.queryByText(/喘不上气是怎么回事/)).toBeNull();
	});
});
