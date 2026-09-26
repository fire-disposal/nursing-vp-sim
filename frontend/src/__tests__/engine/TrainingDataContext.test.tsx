import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
	useEmotionSeed,
	useExamResults,
	useInitialMessages,
	useMessageCorrection,
	usePatientData,
	useRecordMeta,
	useSessionManifest,
} from "@/engine/TrainingDataContext";
import type { TrainingRecordDetail } from "@/engine/training-record-types";
import { makeRecord, withTrainingData } from "@/__tests__/fixtures/record";

function renderDerived(record: TrainingRecordDetail | null) {
	const wrapper = ({ children }: { children: ReactNode }) => withTrainingData(children, record);
	return renderHook(
		() => ({
			meta: useRecordMeta(),
			manifest: useSessionManifest(),
			exam: useExamResults(),
			correction: useMessageCorrection(),
			patient: usePatientData(),
			messages: useInitialMessages(),
		}),
		{ wrapper },
	).result.current;
}

describe("useEmotionSeed（v3 契约：0-100 四维 + dominant_state）", () => {
	function seedOf(emotion: TrainingRecordDetail["emotion"]) {
		const wrapper = ({ children }: { children: ReactNode }) => (
			withTrainingData(children, makeRecord({ emotion }))
		);
		return renderHook(() => useEmotionSeed(), { wrapper }).result.current;
	}

	it("恢复会话种子取后端 4D 快照，而不是要求 comfort/state", () => {
		expect(
			seedOf({ trust: 30, anxiety: 70, irritation: 20, cooperation: 40, dominant_state: "trusting_anxious" }),
		).toEqual({
			trust: 30,
			anxiety: 70,
			irritation: 20,
			cooperation: 40,
			dominant_state: "trusting_anxious",
		});
	});

	it("缺 dominant_state 时回退 neutral 标签", () => {
		expect(seedOf({ trust: 55, anxiety: 10, irritation: 10, cooperation: 90 })?.dominant_state).toBe("neutral");
	});

	it("四维不完整（例如只有 trust/comfort 的 v2 载荷）不产生种子", () => {
		expect(seedOf({ trust: 30, comfort: 70, state: "anxious" })).toBeNull();
	});

	it("无 emotion 字段不产生种子", () => {
		expect(seedOf(null)).toBeNull();
		expect(seedOf(undefined)).toBeNull();
	});
});

describe("派生读取（唯一来源 = RQ 原始 record）", () => {
	it("manifest / patient / messages 都来自同一份原始记录", () => {
		const derived = renderDerived(
			makeRecord({
				patient_name: "李秀兰",
				patient_age: 54,
				patient_gender: "女",
				case_title: "心衰",
				messages: [
					{ id: 1, role: "patient", content: "我这两天总喘不上气", created_at: "2026-09-25T00:01:00+00:00" },
					{ id: 2, role: "student", content: "多久了？", created_at: "2026-09-25T00:02:00+00:00" },
				],
				manifest: {
					schema: "workflow-manifest",
					projection: "session",
					workflow: { id: "history_taking", label: "护理问诊", ui: {} },
					case: { case_id: 1, revision_id: null, revision_no: null },
					session: { session_id: 1, status: "in_progress", revision: 1 },
					activities: [],
					artifacts: {},
					completion: { eligible: true, conditions: [], blockers: [] },
					actions: [{ id: "complete_session", label: "结束训练", enabled: true }],
				},
			}),
		);

		expect(derived.patient).toMatchObject({ name: "李秀兰", age: 54, gender: "female", caseTitle: "心衰" });
		expect(derived.messages.map((m) => m.content)).toEqual(["我这两天总喘不上气", "多久了？"]);
		expect(derived.manifest?.workflow.id).toBe("history_taking");
		expect(derived.manifest?.completion.eligible).toBe(true);
	});

	it("record metadata 给出模式/盲盒/倒计时锚点/问诊清单", () => {
		const derived = renderDerived(
			makeRecord({
				mode: "blind_box",
				hide_case_info: true,
				remaining_seconds: 480,
				required_inquiries: ["胸闷持续时间与诱因"],
			}),
		);

		expect(derived.meta).toEqual({
			mode: "blind_box",
			hideCaseInfo: true,
			remainingSeconds: 480,
			requiredInquiries: ["胸闷持续时间与诱因"],
		});
	});

	it("exam results / message correction 窄化掉生成类型的 unknown 值", () => {
		const derived = renderDerived(
			makeRecord({
				exam_results: [
					{ type: "hr", label: "心率", value: 94, unit: "次/分", status: "normal" },
					{ label: "缺 type" },
				],
				message_correction: { used: 1, remaining: 2, eligible_last_message_id: 101 },
			}),
		);

		expect(derived.exam).toEqual([
			{ type: "hr", label: "心率", value: "94", unit: "次/分", status: "normal", interpretation: undefined },
		]);
		expect(derived.correction).toEqual({ used: 1, remaining: 2, eligible_last_message_id: 101 });
	});

	it("查询未返回时给出安全缺省，而不是抛错或猜数据", () => {
		const derived = renderDerived(null);

		expect(derived.patient).toBeNull();
		expect(derived.messages).toEqual([]);
		expect(derived.manifest).toBeNull();
		expect(derived.exam).toEqual([]);
		expect(derived.correction).toBeNull();
		expect(derived.meta).toEqual({
			mode: "guided",
			hideCaseInfo: false,
			remainingSeconds: null,
			requiredInquiries: [],
		});
	});
});
