import type { ManifestActivity, SessionManifest } from "@/engine/manifest";

/**
 * 测试用的 manifest 构造器 —— 形状与服务端 session projection 对齐
 * （`backend/modules/training/manifest.py`）。只出现在测试里，不进生产代码。
 */
export function makeActivity(id: string, overrides: Partial<ManifestActivity> = {}): ManifestActivity {
	return {
		id,
		label: id,
		availability: { state: "available", reason_code: null },
		commands: [],
		ui: { renderer: id, placement: "side_panel", order: 10 },
		evidence_kind: null,
		artifact_kind: null,
		...overrides,
	};
}

export function makeManifest(overrides: Partial<SessionManifest> = {}): SessionManifest {
	return {
		schema: "workflow-manifest",
		projection: "session",
		workflow: { id: "history_taking", label: "护理问诊", ui: {} },
		case: { case_id: 1, revision_id: null, revision_no: null },
		session: { session_id: 1, status: "in_progress", revision: 1 },
		activities: [],
		artifacts: {},
		completion: { eligible: true, conditions: [], blockers: [] },
		actions: [{ id: "complete_session", label: "结束训练", enabled: true }],
		...overrides,
	};
}
