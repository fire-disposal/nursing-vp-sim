import { describe, expect, it } from "vitest";
import {
	availableActivities,
	blockerActivity,
	completionBlockers,
	completionConditions,
	parseSessionManifest,
	requiredArtifacts,
} from "@/engine/manifest";
import { makeActivity, makeManifest } from "@/__tests__/fixtures/manifest";

describe("parseSessionManifest", () => {
	it("解析 session 投影并按 ui.order 排序（顺序即面板顺序）", () => {
		const manifest = parseSessionManifest(
			makeManifest({
				activities: [
					makeActivity("physical_exam", { ui: { renderer: "physical_exam", placement: "side_panel", order: 20 } }),
					makeActivity("nursing_record", { ui: { renderer: "nursing_record", placement: "side_panel", order: 10 } }),
				],
			}),
		);

		expect(manifest?.activities.map((activity) => activity.id)).toEqual([
			"nursing_record",
			"physical_exam",
		]);
	});

	it("解析 artifacts / completion / actions", () => {
		const manifest = parseSessionManifest(
			makeManifest({
				artifacts: { nursing_record: { required: true, state: "draft", submitted_at: null, updated_at: null } },
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
			}),
		);

		expect(manifest?.artifacts.nursing_record).toEqual({
			required: true,
			state: "draft",
			submitted_at: null,
			updated_at: null,
		});
		expect(completionConditions(manifest)).toEqual([
			{ id: "nursing_record_submitted", label: "提交护理记录", satisfied: false },
		]);
		expect(completionBlockers(manifest)).toEqual([
			{
				code: "ARTIFACT_NOT_SUBMITTED",
				message: "请先提交护理记录，再结束训练",
				target: { type: "artifact", id: "nursing_record" },
			},
		]);
		expect(manifest?.actions[0]).toEqual({ id: "complete_session", label: "结束训练", enabled: false });
	});

	it("非 session 投影 / 结构不完整时返回 null（不回退到前端自算能力）", () => {
		expect(parseSessionManifest(null)).toBeNull();
		expect(parseSessionManifest(undefined)).toBeNull();
		expect(parseSessionManifest({ projection: "catalog" })).toBeNull();
		expect(parseSessionManifest(makeManifest({ projection: "catalog" }))).toBeNull();
		expect(parseSessionManifest({ projection: "session" })).toBeNull();
	});

	it("缺字段的 activity 被丢弃，可用性原样保留", () => {
		const manifest = parseSessionManifest(
			makeManifest({
				activities: [
					makeActivity("quiz", { availability: { state: "unavailable", reason_code: "case_not_configured" } }),
					{ label: "无 id" } as never,
				],
			}),
		);

		expect(manifest?.activities).toEqual([
			{
				id: "quiz",
				label: "quiz",
				availability: { state: "unavailable", reason_code: "case_not_configured" },
				commands: [],
				ui: { renderer: "quiz", placement: "side_panel", order: 10 },
				evidence_kind: null,
				artifact_kind: null,
			},
		]);
	});
});

describe("读取器", () => {
	const manifest = parseSessionManifest(
		makeManifest({
			activities: [
				makeActivity("nursing_record", {
					label: "护理记录",
					artifact_kind: "nursing_record",
					ui: { renderer: "nursing_record", placement: "side_panel", order: 10 },
				}),
				makeActivity("quiz", { availability: { state: "unavailable", reason_code: "case_not_configured" } }),
			],
			artifacts: {
				nursing_record: { required: true, state: "empty", submitted_at: null, updated_at: null },
			},
		}),
	);

	it("availableActivities 只保留服务端标为 available 的项", () => {
		expect(availableActivities(manifest).map((activity) => activity.id)).toEqual(["nursing_record"]);
		expect(availableActivities(null)).toEqual([]);
	});

	it("blockerActivity 把产物目标映射到面板，其它目标不猜", () => {
		expect(
			blockerActivity(manifest, {
				code: "ARTIFACT_NOT_SUBMITTED",
				message: "请先提交护理记录",
				target: { type: "artifact", id: "nursing_record" },
			})?.id,
		).toBe("nursing_record");
		expect(
			blockerActivity(manifest, { code: "SESSION_NOT_ACTIVE", message: "训练已结束", target: null }),
		).toBeUndefined();
	});

	it("requiredArtifacts 只取 required 的产物", () => {
		expect(requiredArtifacts(manifest)).toEqual(["nursing_record"]);
		expect(requiredArtifacts(null)).toEqual([]);
	});
});
