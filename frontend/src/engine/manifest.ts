/**
 * Resolved Manifest 读取层（docs/15 §四·补 / §十三 / §十五）。
 *
 * 服务端是唯一真相源：`availability` / `completion` / `artifacts` 一律读这里下发的值，
 * 前端**不得**重新推导「这个病例有没有某能力」「能不能结束训练」。
 *
 * 本模块是纯函数 + 类型：没有 React、没有网络、没有面板注册表。
 * renderer key → 组件 的映射见 `components/training/workspace/renderers.ts`。
 */

export const ACTIVITY_STATE_AVAILABLE = "available";

export const ARTIFACT_EMPTY = "empty";
export const ARTIFACT_DRAFT = "draft";
export const ARTIFACT_SUBMITTED = "submitted";

/** manifest.actions[].id：学生主动结束训练 */
export const ACTION_COMPLETE_SESSION = "complete_session";

/** completion.blockers[].code —— 前端只用于给 blocker 找到落点，不用于判定 */
export const CODE_SESSION_NOT_ACTIVE = "SESSION_NOT_ACTIVE";
export const CODE_ARTIFACT_NOT_SUBMITTED = "ARTIFACT_NOT_SUBMITTED";

export interface ManifestActivityAvailability {
	state: string;
	reason_code: string | null;
}

export interface ManifestActivityUI {
	/** 渲染组件 key（RendererMap 的键） */
	renderer: string;
	/** 形态：side_panel / …（当前只有侧栏/底部面板） */
	placement: string;
	/** 面板顺序（越小越靠前） */
	order: number;
}

export interface ManifestActivity {
	id: string;
	label: string;
	availability: ManifestActivityAvailability;
	commands: string[];
	ui: ManifestActivityUI;
	evidence_kind: string | null;
	artifact_kind: string | null;
}

export interface ManifestArtifact {
	required: boolean;
	state: string;
	submitted_at: string | null;
	updated_at: string | null;
}

export interface ManifestBlockerTarget {
	type: string;
	id: string;
}

export interface ManifestBlocker {
	code: string;
	message: string;
	target: ManifestBlockerTarget | null;
}

export interface ManifestCondition {
	id: string;
	label: string;
	satisfied: boolean;
}

export interface ManifestAction {
	id: string;
	label: string;
	enabled: boolean;
}

export interface SessionManifest {
	schema: string;
	projection: string;
	workflow: { id: string; label: string; ui: Record<string, string> };
	case: { case_id: number | null; revision_id: number | null; revision_no: number | null };
	session: { session_id: number | null; status: string; revision: number | null };
	activities: ManifestActivity[];
	artifacts: Record<string, ManifestArtifact>;
	completion: {
		eligible: boolean;
		conditions: ManifestCondition[];
		blockers: ManifestBlocker[];
	};
	actions: ManifestAction[];
}

// ── 窄化工具（服务端载荷是 JSON，逐个字段收敛，缺字段不猜）──────────────

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function flag(value: unknown): boolean {
	return value === true;
}

function optionalNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseActivity(raw: unknown): ManifestActivity | null {
	const item = asRecord(raw);
	if (!item) return null;
	const id = text(item.id);
	if (!id) return null;
	const availability = asRecord(item.availability) ?? {};
	const ui = asRecord(item.ui) ?? {};
	return {
		id,
		label: text(item.label) || id,
		availability: {
			state: text(availability.state),
			reason_code: optionalText(availability.reason_code),
		},
		commands: strList(item.commands),
		ui: {
			renderer: text(ui.renderer),
			placement: text(ui.placement) || "side_panel",
			order: optionalNumber(ui.order) ?? 0,
		},
		evidence_kind: optionalText(item.evidence_kind),
		artifact_kind: optionalText(item.artifact_kind),
	};
}

function parseArtifact(raw: unknown): ManifestArtifact | null {
	const item = asRecord(raw);
	if (!item) return null;
	return {
		required: flag(item.required),
		state: text(item.state) || ARTIFACT_EMPTY,
		submitted_at: optionalText(item.submitted_at),
		updated_at: optionalText(item.updated_at),
	};
}

function parseBlocker(raw: unknown): ManifestBlocker | null {
	const item = asRecord(raw);
	if (!item) return null;
	const target = asRecord(item.target);
	return {
		code: text(item.code),
		message: text(item.message),
		target: target ? { type: text(target.type), id: text(target.id) } : null,
	};
}

/**
 * 解析会话 manifest。
 *
 * 非 session 投影 / 结构不对时返回 `null` —— 调用方按「清单未到位」处理
 * （等待完整详情），绝不回退到前端自算的能力表。
 */
export function parseSessionManifest(raw: unknown): SessionManifest | null {
	const data = asRecord(raw);
	if (!data) return null;
	if (text(data.projection) !== "session") return null;
	const workflow = asRecord(data.workflow);
	const session = asRecord(data.session);
	if (!workflow || !session) return null;

	const activities = (Array.isArray(data.activities) ? data.activities : [])
		.map(parseActivity)
		.filter((activity): activity is ManifestActivity => activity !== null)
		.sort((a, b) => a.ui.order - b.ui.order);

	const artifacts: Record<string, ManifestArtifact> = {};
	for (const [kind, value] of Object.entries(asRecord(data.artifacts) ?? {})) {
		const artifact = parseArtifact(value);
		if (artifact) artifacts[kind] = artifact;
	}

	const completion = asRecord(data.completion) ?? {};
	const caseInfo = asRecord(data.case) ?? {};

	return {
		schema: text(data.schema),
		projection: text(data.projection),
		workflow: {
			id: text(workflow.id),
			label: text(workflow.label),
			ui: Object.fromEntries(
				Object.entries(asRecord(workflow.ui) ?? {}).map(([key, value]) => [key, text(value)]),
			),
		},
		case: {
			case_id: optionalNumber(caseInfo.case_id),
			revision_id: optionalNumber(caseInfo.revision_id),
			revision_no: optionalNumber(caseInfo.revision_no),
		},
		session: {
			session_id: optionalNumber(session.session_id),
			status: text(session.status),
			revision: optionalNumber(session.revision),
		},
		activities,
		artifacts,
		completion: {
			eligible: flag(completion.eligible),
			conditions: (Array.isArray(completion.conditions) ? completion.conditions : [])
				.map((raw) => {
					const item = asRecord(raw);
					if (!item) return null;
					return {
						id: text(item.id),
						label: text(item.label) || text(item.id),
						satisfied: flag(item.satisfied),
					};
				})
				.filter((condition): condition is ManifestCondition => condition !== null),
			blockers: (Array.isArray(completion.blockers) ? completion.blockers : [])
				.map(parseBlocker)
				.filter((blocker): blocker is ManifestBlocker => blocker !== null),
		},
		actions: (Array.isArray(data.actions) ? data.actions : [])
			.map((raw) => {
				const item = asRecord(raw);
				if (!item) return null;
				return { id: text(item.id), label: text(item.label) || text(item.id), enabled: flag(item.enabled) };
			})
			.filter((action): action is ManifestAction => action !== null),
	};
}

// ── 读取器（全部读服务端字段，不做任何推断）──────────────────────────────

/** 当前会话内可用的 Activity（顺序 = manifest 顺序 = 服务端 ui.order）。 */
export function availableActivities(manifest: SessionManifest | null): ManifestActivity[] {
	if (!manifest) return [];
	return manifest.activities.filter((activity) => activity.availability.state === ACTIVITY_STATE_AVAILABLE);
}

/**
 * blocker 对应的落点：`target.type === "artifact"` → 产出该产物的 Activity。
 *
 * 只回答「该跳进哪个面板」，不回答「能不能完成」——后者始终由服务端 eligible 决定。
 */
export function blockerActivity(manifest: SessionManifest | null, blocker: ManifestBlocker): ManifestActivity | undefined {
	if (blocker.target?.type !== "artifact") return undefined;
	return manifest?.activities.find((activity) => activity.artifact_kind === blocker.target?.id);
}

/**
 * 完成前置：workflow 声明必须已提交的产物 kinds（`manifest.artifacts[].required`）。
 *
 * 用于把 `/end` 的原子「提交并完成」载荷与服务端声明对齐，而不是前端判定能否结束。
 */
export function requiredArtifacts(manifest: SessionManifest | null): string[] {
	if (!manifest) return [];
	return Object.entries(manifest.artifacts)
		.filter(([, artifact]) => artifact.required)
		.map(([kind]) => kind);
}

export function completionBlockers(manifest: SessionManifest | null): ManifestBlocker[] {
	return manifest?.completion.blockers ?? [];
}

export function completionConditions(manifest: SessionManifest | null): ManifestCondition[] {
	return manifest?.completion.conditions ?? [];
}
