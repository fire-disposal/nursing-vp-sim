import { describe, expect, it } from "vitest";
import { ACTIVITY_RENDERERS } from "@/components/training/workspace/renderers";
import { availableActivities, blockerActivity, parseSessionManifest, requiredArtifacts } from "@/engine/manifest";
import case1Payload from "@/__tests__/fixtures/session-manifest.case1.json";
import quizPayload from "@/__tests__/fixtures/session-manifest.quiz.json";
import coverage from "@/__tests__/fixtures/case-manifest-coverage.json";

/**
 * 前端与**真实后端载荷**的形状对齐（docs/15 §十五 CI 断言）。
 *
 * 夹具不是手写的：由后端解析器 `backend/modules/training/manifest.py`
 * 对 `data/cases/*.json` 逐个 `build_session_manifest(...)` 生成，
 * 因此这里同时验证「服务端下发的 renderer 在前端都有组件」。
 */
describe("manifest 契约对齐（真实后端载荷）", () => {
	it("所有病例声明的 ui.renderer 都在前端 RendererMap 中（不存在「配了但不可达」）", () => {
		const missing: string[] = [];
		for (const [caseName, entry] of Object.entries(coverage)) {
			for (const renderer of (entry as { renderers: string[] }).renderers) {
				if (!ACTIVITY_RENDERERS[renderer]) missing.push(`${caseName}:${renderer}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it("每个病例的工作区 = manifest.workflow.id 且必交产物与服务端一致", () => {
		for (const entry of Object.values(coverage)) {
			const item = entry as { workflow: string; available: string[]; requiredArtifacts: string[] };
			expect(item.workflow).toBe("history_taking");
			expect(item.available).toContain("nursing_record");
			expect(item.requiredArtifacts).toEqual(["nursing_record"]);
		}
	});

	it("case1 载荷：可用面板按 ui.order 排列，未配置的 quiz/nursing_diagnosis 不进面板", () => {
		const manifest = parseSessionManifest(case1Payload);
		expect(manifest?.workflow).toEqual({ id: "history_taking", label: "病史采集", ui: { workspace: "patient_interaction", primary_surface: "conversation" } });
		expect(availableActivities(manifest).map((activity) => activity.id)).toEqual([
			"nursing_record",
			"physical_exam",
		]);
		// 读取层把 activities 规范成 ui.order 顺序（服务端下发的原始顺序不承诺有序）
		expect(manifest?.activities.map((activity) => activity.id)).toEqual([
			"nursing_record",
			"physical_exam",
			"quiz",
			"nursing_diagnosis",
		]);
	});

	it("case1 载荷：完成条件来自服务端（草稿未提交即不可结束）", () => {
		const manifest = parseSessionManifest(case1Payload);
		expect(manifest?.artifacts.nursing_record).toEqual({
			required: true,
			state: "empty",
			submitted_at: null,
			updated_at: null,
		});
		expect(manifest?.completion.eligible).toBe(false);
		expect(manifest?.completion.blockers.map((blocker) => blocker.code)).toEqual([
			"ARTIFACT_NOT_SUBMITTED",
		]);
		expect(manifest?.completion.blockers[0].message).toContain("护理记录");
		expect(manifest?.actions).toEqual([{ id: "complete_session", label: "结束训练", enabled: false }]);
	});

	it("quiz 病例：唯一挂载 quiz 的病例在面板里可达，且 blocker 能定位到产物面板", () => {
		const manifest = parseSessionManifest(quizPayload);
		expect(availableActivities(manifest).map((activity) => activity.id)).toContain("quiz");
		expect(requiredArtifacts(manifest)).toEqual(["nursing_record"]);

		const blocker = manifest?.completion.blockers[0];
		expect(blocker).toBeDefined();
		expect(blockerActivity(manifest, blocker!)?.id).toBe("nursing_record");
	});

	it("未挂载问诊清单/无可用能力的病例：面板集合只是空，不猜能力", () => {
		const manifest = parseSessionManifest({
			...case1Payload,
			activities: case1Payload.activities.map((activity) => ({
				...activity,
				availability: { state: "unavailable", reason_code: "case_not_configured" },
			})),
		});

		expect(availableActivities(manifest)).toEqual([]);
	});
});
