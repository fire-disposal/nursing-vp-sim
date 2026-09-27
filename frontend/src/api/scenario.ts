import { isAxiosError } from "axios";
import useAuthStore from "@/stores/authStore";
import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

// --------------------------------------------------------------------------- //
// 学生可见视图（`build_view` 的投影）
//
// 后端这些接口返回的是投影 dict，openapi 里只生成到 `{ [key: string]: unknown }`
// （FastAPI 无法从 `dict[str, Any]` 反推形状），所以形状在这里按后端
// `modules/scenario_training/runtime/view.py` 的键**镜像声明**（只声明 UI 实际消费的键，
// 后端多出来的键 UI 不读）；
// 请求体的类型仍直接取生成物（`Schemas["OpenSessionRequest"]` / `["ActionRequest"]`）。
// 本模块是唯一的收口处：视图字段与后端不同步只改这里，页面不各自猜形状。
// --------------------------------------------------------------------------- //

/** `GET /scenario/packs` 的一项：情境包摘要（含最新修订）。 */
export interface ScenarioPackSummary {
	key: string;
	title: string;
	state: string;
	one_line: string;
	revision_id: number | null;
	revision_no: number | null;
}

export interface ScenarioMessage {
	/** `student` = 学生自己做过的事（自由表达的原话 / 按钮与选项的标签）。 */
	role: "scene" | "actor" | "student";
	text: string;
	/** `role === "actor"` 时的说话人 id（**临时角色可能为空**）。 */
	actor?: string | null;
	/** 显示用身份名：声明角色给 pack 的 role，临时角色给 DM 写的显示名。 */
	actor_role?: string | null;
	/** true = 只在这一次出现（走廊护工 / 广播 / 电话另一头），不入在场者名册。 */
	ephemeral?: boolean;
	/** 头像种子（临时角色 = 显示名，声明角色 = actor id），头像由前端派生。 */
	avatar_seed?: string | null;
	/** `dm` = DM 代言；`entity` = 独立角色实体自己说的话。 */
	origin?: string;
	turn?: number;
}

export interface ScenarioOption {
	label?: string | null;
	type?: string | null;
	affordance_id?: string | null;
	params?: Record<string, unknown>;
	free_input?: boolean;
}

export type ScenarioSelect = "none" | "single" | "multi";

export interface ScenarioAffordance {
	id: string;
	type: string;
	label: string;
	select: ScenarioSelect;
	/** `select !== "none"` 时的可选项（来自 pack 声明）。 */
	options: string[];
	/** `type === "document"` 时的记录字段名。 */
	fields: string[];
	free_input: boolean;
	confirm: boolean;
}

export interface ScenarioActor {
	id: string;
	role: string;
	presence: string;
	present: boolean;
}

export interface ScenarioHudSlot {
	slot: string;
	source: "state" | "cue" | "actor" | "affordance";
	label?: string;
	value?: unknown;
	ref?: string;
	items?: string[];
	count?: number;
}

export interface ScenarioSituation {
	place: string;
	time_hint: string;
	resources: string[];
	visible_cues: string[];
	noticed: string[];
}

export interface ScenarioTimelineEntry {
	turn: number;
	kind: "student" | "world";
	label: string;
	by?: string | null;
}

export interface ScenarioDim {
	id: string;
	label: string;
	agg: string;
	value: unknown;
	unit: string;
	detail: string;
}

/** 场景资源包内的预定义图片（场景准备者预先准备）。 */
export interface ScenarioAsset {
	id: string;
	title: string;
	alt: string;
	url: string;
	suggest_when: string;
}

/** 本回合 DM 决定展示的图片。`origin === "generated"` 才可能来自绘画者 AI。 */
export interface ScenarioImage {
	asset_id: string;
	url: string;
	title: string;
	alt: string;
	caption: string;
	origin: "pack" | "generated" | string;
}

/** 线索板条目的类别（后端封闭词表）：现场线索 / 读数 / 你注意到的 / 已确认 / 已处置 / 板上的判断。 */
export type ScenarioBoardKind =
	| "cue"
	| "state"
	| "noticed"
	| "fact"
	| "action"
	| "note";

/** 板上的条目来源：pack 声明 / 世界状态 / DM 写入 / 学生动作。 */
export type ScenarioBoardSource = "pack" | "world" | "dm" | "student";

/** 线索板的一条：**单行**（`text` 后端已限长去重，前端不再截断或补全）。 */
export interface ScenarioBoardEntry {
	id: string;
	kind: ScenarioBoardKind;
	text: string;
	source: ScenarioBoardSource;
	/** `kind === "fact"` 时的原话证据（次行小字，不展开成长段落）。 */
	evidence?: string;
	/** `kind === "state"` 的读数。 */
	value?: number;
	/** `kind === "action"` 的合并次数（`text` 已含 `×N`，这用于徽章）。 */
	count?: number;
	turn?: number;
	/** 已被后续条目订正（旧条目**不消失**，划线保留）。 */
	superseded?: boolean;
	/** 该条目订正了哪一条（`superseded` 的逆向指针）。 */
	supersedes?: string;
}

/** 线索板的一个版块：同一来源的条目按来源聚成一段。 */
export interface ScenarioBoardSection {
	id: string;
	title: string;
	source: ScenarioBoardKind;
	entries: ScenarioBoardEntry[];
	/** 超过每版块上限、被截掉的条数（`>0` 时版块底部提示）。 */
	more: number;
}

/**
 * 线索板（白板）：**只读、按需具现**的事实区。
 *
 * `editable` 恒为 false（学生只能通过"做事情"让它长出来）；版块与条目由后端按
 * 触发条件投影，缺省即"此刻还不该出现"——前端不缓存旧视图、不补位。
 */
export interface ScenarioBoard {
	editable: boolean;
	entry_count: number;
	sections: ScenarioBoardSection[];
}

/** 设备类型：监护仪 / 值班电话 / 输液泵 / 其它。 */
export type ScenarioDeviceKind = "monitor" | "phone" | "pump" | "other";

/** 通道状态：正常 / 偏低 / 偏高 / 危急 / 未知（配色见 `status` 钩子，**不闪烁**）。 */
export type ScenarioChannelStatus =
	| "normal"
	| "low"
	| "high"
	| "critical"
	| "unknown";

/**
 * 设备的一个通道读数。
 *
 * `display` 是**后端格式化好的**字符串（小数位由 pack 声明），前端不再自己格式化；
 * `delta`/`history` 只在 pack 声明了趋势时才给（否则为 `null` / `[]`）。
 */
export interface ScenarioDeviceChannel {
	ref: string;
	label: string;
	unit: string;
	display: string;
	value: unknown;
	status: ScenarioChannelStatus;
	delta: number | null;
	history: number[];
	normal: [number, number] | null;
	critical: [number, number] | null;
}

/** 场景里的一台设备（监护仪 / 值班电话…）。服务端已按需求过滤：不该出现的根本不会来。 */
export interface ScenarioDevice {
	id: string;
	kind: ScenarioDeviceKind;
	title: string;
	/** `beep` 才给提示音；`off`（或不声明）表示这台设备不响。 */
	sound: "off" | "beep";
	channels: ScenarioDeviceChannel[];
}

export interface ScenarioView {
	session: { id: number; status: string; turn: number; lost: boolean };
	pack: { key: string; title: string; player_role: string; revision_id?: number | null };
	situation: ScenarioSituation;
	actors: ScenarioActor[];
	hud: ScenarioHudSlot[];
	messages: ScenarioMessage[];
	options: ScenarioOption[];
	affordances: ScenarioAffordance[];
	free_input: boolean;
	timeline: ScenarioTimelineEntry[];
	dims: ScenarioDim[];
	nudges: string[];
	problems: string[];
	/** pack 声明的呈现面板：timeline / emotion / coverage（空 = 不声明，UI 全开）。 */
	panels?: string[];
	/** 后端实验面在补：缺失时按"没有图"渲染，不占位、不造假图。 */
	assets?: ScenarioAsset[];
	images?: ScenarioImage[];
	/** 线索板（只读事实区）；老后端没有这个键时按"没有板"渲染。 */
	board?: ScenarioBoard;
	/** 设备面（实时读数）；服务端按需求过滤，缺省即"此刻没有设备"。 */
	devices?: ScenarioDevice[];
}

export type ScenarioAnchor = "strong" | "adequate" | "missed";

/**
 * 结算报告的一条评分条目（场景作者自己写的 rubric：条目数、标题、权重都不同）。
 *
 * `weight` 是**平台/维护者的事**：学生侧只看 `title` + 锚点 + `detail`，
 * 看到权重只会诱发凑分；管理侧才展开完整明细。
 */
export interface ScenarioCriterion {
	id: string;
	title: string;
	anchor: ScenarioAnchor;
	/** 锚点映射到的得分（0..1）——只在管理侧显示数值。 */
	score: number;
	weight: number;
	detail: string;
	evidence: string[];
}

/** 得分率汇总：`rate` 为 `null` 表示本情境没有可计权的条目（不是 0 分）。 */
export interface ScenarioScore {
	rate: number | null;
	weighted_sum: number;
	total_weight: number;
	criteria: ScenarioCriterion[];
}

/** 结算报告（`POST /close` 的 `report`，也是"经历页"的数据源）。 */
export interface ScenarioReport {
	pack: { key: string; title: string };
	turn: number;
	lost: boolean;
	summary: Record<string, number>;
	score: ScenarioScore;
	criteria: ScenarioCriterion[];
	dims: ScenarioDim[];
	timeline: ScenarioTimelineEntry[];
	problems: string[];
}

export interface ScenarioSessionResponse {
	session_id: number;
	pack: { key: string; title: string; revision_id: number };
	view: ScenarioView;
}

/** `GET /sessions/{id}`：会话 + 可能已存在的报告（重入时用）。 */
export interface ScenarioSessionState {
	session_id: number;
	status: string;
	report: ScenarioReport | null;
	view: ScenarioView;
}

export interface ScenarioTurnResponse {
	session_id: number;
	problems: string[];
	view: ScenarioView;
}

export interface ScenarioCloseResponse {
	session_id: number;
	report: ScenarioReport;
	view: ScenarioView;
}

/** 学生做的一件事：`text` = 自由发问；`selected`/`custom_text` = 选择型动作与自输入。 */
export interface ScenarioActionInput {
	affordance_id?: string | null;
	type: string;
	text?: string | null;
	selected?: string[];
	custom_text?: string | null;
}

/** `GET /scenario/sessions`（我的情境历史）与 `/admin/sessions` 列表行。 */
export interface ScenarioSessionRow {
	id: number;
	pack_key: string;
	pack_title: string;
	status: string;
	turn: number | null;
	lost: boolean | null;
	summary: Record<string, number> | null;
	created_at: string | null;
	updated_at: string | null;
}

/** 管理侧会话行额外带学生与修订（学生侧不返回这些键）。 */
export interface ScenarioAdminSessionRow extends ScenarioSessionRow {
	user_id: number;
	pack_revision_id: number;
}

/** 管理侧：一次修订。 */
export interface ScenarioAdminRevision {
	id: number;
	no: number;
	note: string;
}

/** 管理侧：资源声明 + 库里是否已有字节（`uploaded=false` = 只有声明，取图会 404）。 */
export interface ScenarioAdminAsset {
	id: string;
	kind: string;
	title: string;
	alt: string;
	suggest_when: string;
	filename: string;
	mime_type: string;
	file_size: number;
	uploaded: boolean;
}

/** 管理侧：`GET /scenario/admin/packs` 的一项。 */
export interface ScenarioAdminPack {
	key: string;
	title: string;
	state: string;
	one_line: string;
	revision_id: number | null;
	revision_no: number | null;
	revisions: ScenarioAdminRevision[];
	assets: ScenarioAdminAsset[];
	sessions: number;
}

/** `POST /scenario/admin/packs`：上传包 JSON 的结果。 */
export interface ScenarioAdminPackUpload {
	key: string;
	revision_id: number;
	revision_no: number;
	/** false = 内容与既有最新修订一致（幂等，未新增修订）。 */
	created: boolean;
	/** pack 声明了但库里还没有字节的资源 id。 */
	assets_pending: string[];
}

/** `POST /scenario/admin/packs/{key}/assets`：上传图片的结果（上传即追加一个新修订）。 */
export interface ScenarioAdminAssetUpload {
	key: string;
	revision_no: number;
	asset: ScenarioAdminAsset;
}

/** 管理侧：会话回放里的一条事件（`payload` 形状随 `kind` 变化，按原样呈现）。 */
export interface ScenarioAdminEvent {
	kind: string;
	payload: Record<string, unknown> | null;
}

/** 管理侧：`GET /scenario/admin/sessions` 的分页结果。 */
export interface ScenarioAdminSessionList {
	total: number;
	items: ScenarioAdminSessionRow[];
}

/** 管理侧：单次会话的完整回放（含**每回合诊断问题**，仅维护者可见）。 */
export interface ScenarioAdminSessionDetail {
	session: ScenarioAdminSessionRow;
	view: ScenarioView;
	report: ScenarioReport | null;
	problems: string[];
	event_count: number;
	events: ScenarioAdminEvent[];
}

/** 管理侧：按包的汇总。 */
export interface ScenarioAdminStatsBucket {
	pack_key: string;
	pack_title: string;
	sessions: number;
	completed: number;
	lost: number;
	anchors: { strong: number; adequate: number; missed: number };
}

export interface ScenarioAdminStats {
	packs: ScenarioAdminStatsBucket[];
}

/** 管理侧：DM 运行期生成的图片（按病例分页）。 */
export interface ScenarioGeneratedAsset {
	id: number;
	session_id: number;
	pack_key: string;
	pack_revision_id: number;
	kind: string;
	prompt: string;
	mime_type: string;
	file_size: number;
	sha256: string;
	created_at: string | null;
}

export interface ScenarioGeneratedList {
	items: ScenarioGeneratedAsset[];
	total: number;
}

export interface ScenarioGeneratedQuery {
	limit?: number;
	offset?: number;
	session_id?: number | null;
}

export interface ScenarioAdminSessionQuery {
	pack_key?: string | null;
	status?: string | null;
	limit?: number;
	offset?: number;
}

/** 包状态（生成物 `PackState` 的封闭两值）：`experimental` 允许犯错，`reviewed` 才算定稿。 */
export type ScenarioPackState = NonNullable<Schemas["PackState"]>;

/** 上传请求体：multipart 的字段名与生成物一致，只有 `file` 在浏览器里是 `File`（生成物是二进制字符串）。 */
export type ScenarioPackUploadInput = Omit<
	Schemas["Body_admin_upload_pack_api_scenario_admin_packs_post"],
	"file"
> & { file: File };

export type ScenarioAssetUploadInput = Omit<
	Schemas["Body_admin_upload_asset_api_scenario_admin_packs__pack_key__assets_post"],
	"file"
> & { file: File };

// --------------------------------------------------------------------------- //
// 调用
// --------------------------------------------------------------------------- //

export const listScenarioPacks = () =>
	api
		.get<ScenarioPackSummary[]>("/scenario/packs" satisfies ApiPath as string)
		.then((r) => r.data);

export const createScenarioSession = (
	payload: Schemas["OpenSessionRequest"] = {},
) =>
	api
		.post<ScenarioSessionResponse>(
			"/scenario/sessions" satisfies ApiPath as string,
			payload,
		)
		.then((r) => r.data);

export const getScenarioSession = (sessionId: number) =>
	api
		.get<ScenarioSessionState>(
			`/scenario/sessions/${sessionId}` as ApiPath,
		)
		.then((r) => r.data);

export const postScenarioAction = (
	sessionId: number,
	action: ScenarioActionInput,
) =>
	api
		.post<ScenarioTurnResponse>(
			`/scenario/sessions/${sessionId}/actions` as ApiPath,
			{
				affordance_id: action.affordance_id ?? null,
				type: action.type,
				text: action.text ?? null,
				selected: action.selected ?? [],
				custom_text: action.custom_text ?? null,
			} satisfies Schemas["ActionRequest"],
		)
		.then((r) => r.data);

// --------------------------------------------------------------------------- //
// 流式回合（SSE）
//
// `EventSource` 只支持 GET，而这里要 POST 一个动作，所以用 `fetch` + `getReader()`
// 自己按行切（与 `./stream.ts` 的做法一致）。
// --------------------------------------------------------------------------- //

/** SSE 的三种事件：增量块 / 权威视图 / 已知失败面。 */
export type ScenarioStreamEvent =
	| { kind: "blocks"; blocks: Record<string, unknown> }
	| {
			kind: "view";
			view: ScenarioView;
			problems: string[];
			session_id: number;
	  }
	| { kind: "error"; message: string };

/**
 * 「流式这条路走不通」——调用方应当**自动退回非流式** `/actions`（行为与今天一致，不得更差）。
 *
 * 只覆盖"换条路就能成"的情况：浏览器没有 fetch/流、连接中断、端点不存在（404/405/501）、
 * 流结束却一个事件都没给。**业务失败**（如 409 已结束、403、422）不走这个异常。
 */
export class ScenarioStreamUnavailable extends Error {}

function streamUrl(sessionId: number): string {
	const base = api.defaults.baseURL ?? "";
	return `${base}/scenario/sessions/${sessionId}/actions/stream`;
}

/**
 * 流式提交一个动作；每个事件都会同步回调 `onEvent`。
 *
 * 正常返回 = 至少收到过一个事件（`view` 或 `error` 由调用方处理）；
 * 抛 `ScenarioStreamUnavailable` = 该退回非流式；抛别的错误 = 真正的失败（照旧报给用户）。
 */
export async function streamScenarioAction(
	sessionId: number,
	action: ScenarioActionInput,
	onEvent: (event: ScenarioStreamEvent) => void,
	signal?: AbortSignal,
): Promise<void> {
	if (typeof fetch !== "function") {
		throw new ScenarioStreamUnavailable("这个浏览器不支持流式读取");
	}

	let response: Response;
	try {
		response = await fetch(streamUrl(sessionId), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(useAuthStore.getState().token
					? { Authorization: `Bearer ${useAuthStore.getState().token}` }
					: {}),
			},
			body: JSON.stringify({
				affordance_id: action.affordance_id ?? null,
				type: action.type,
				text: action.text ?? null,
				selected: action.selected ?? [],
				custom_text: action.custom_text ?? null,
			} satisfies Schemas["ActionRequest"]),
			signal,
		});
	} catch (err) {
		// 主动取消不算"走不通"，交给上层按取消处理
		if (signal?.aborted) throw err;
		throw new ScenarioStreamUnavailable("流式连接建立失败");
	}

	if (response.status === 404 || response.status === 405 || response.status === 501) {
		throw new ScenarioStreamUnavailable(`流式端点不可用（${response.status}）`);
	}
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new ScenarioHttpError(response.status, detail);
	}
	if (response.body === null) {
		throw new ScenarioStreamUnavailable("响应没有可读的流");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let seen = 0;

	const consume = (chunk: string) => {
		for (const raw of chunk.split("\n")) {
			const line = raw.trimStart();
			if (!line.startsWith("data:")) continue;
			const payload = line.slice(5).trim();
			if (!payload) continue;
			let event: ScenarioStreamEvent;
			try {
				event = JSON.parse(payload) as ScenarioStreamEvent;
			} catch {
				continue; // 半个 JSON 不猜，等下一个块
			}
			seen += 1;
			onEvent(event);
		}
	};

	while (true) {
		let step: ReadableStreamReadResult<Uint8Array>;
		try {
			step = await reader.read();
		} catch (err) {
			if (seen > 0 || signal?.aborted) throw err;
			throw new ScenarioStreamUnavailable("流在给出任何内容前中断");
		}
		if (step.done) break;
		buffer += decoder.decode(step.value, { stream: true });
		const boundary = buffer.lastIndexOf("\n\n");
		if (boundary === -1) continue;
		const ready = buffer.slice(0, boundary);
		buffer = buffer.slice(boundary + 2);
		consume(ready);
	}
	buffer += decoder.decode();
	consume(buffer);

	if (seen === 0) throw new ScenarioStreamUnavailable("流结束了但没有给出任何事件");
}

/** HTTP 层失败（带状态码与原文），让上层照旧用 409/403 这些既有语义处理。 */
export class ScenarioHttpError extends Error {
	readonly status: number;
	readonly detail: string;
	constructor(status: number, detail: string) {
		super(detail || `请求失败（${status}）`);
		this.name = "ScenarioHttpError";
		this.status = status;
		this.detail = detail;
	}
}

export const closeScenarioSession = (sessionId: number) =>
	api
		.post<ScenarioCloseResponse>(
			`/scenario/sessions/${sessionId}/close` as ApiPath,
		)
		.then((r) => r.data);

/** 我的情境历史（学生侧）：本人所有会话，最近的在前。 */
export const listMyScenarioSessions = () =>
	api
		.get<ScenarioSessionRow[]>("/scenario/sessions" satisfies ApiPath as string)
		.then((r) => r.data);

// --------------------------------------------------------------------------- //
// 管理侧（内容需 `case_manage`，数据需 `stats_view`；缺失一律 403）
// --------------------------------------------------------------------------- //

export const listAdminScenarioPacks = () =>
	api
		.get<ScenarioAdminPack[]>(
			"/scenario/admin/packs" satisfies ApiPath as string,
		)
		.then((r) => r.data);

/** 上传（或覆盖）一份情境包 JSON —— 服务端按内容追加新修订（内容未变即幂等）。 */
export const uploadAdminScenarioPack = (payload: ScenarioPackUploadInput) => {
	const form = new FormData();
	form.append("file", payload.file);
	form.append("note", payload.note ?? "");
	return api
		.post<ScenarioAdminPackUpload>(
			"/scenario/admin/packs" satisfies ApiPath as string,
			form,
		)
		.then((r) => r.data);
};

export const patchAdminScenarioPack = (
	packKey: string,
	payload: Schemas["PackPatchRequest"],
) =>
	api
		.patch<{ key: string; state: string; title: string; one_line: string }>(
			`/scenario/admin/packs/${packKey}` as ApiPath,
			payload,
		)
		.then((r) => r.data);

/** 上传一张场景图片：**上传即追加一个新修订**（声明与字节一起版本化）。 */
export const uploadAdminScenarioAsset = (
	packKey: string,
	payload: ScenarioAssetUploadInput,
) => {
	const form = new FormData();
	form.append("asset_id", payload.asset_id);
	form.append("file", payload.file);
	form.append("title", payload.title ?? "");
	form.append("alt", payload.alt ?? "");
	form.append("suggest_when", payload.suggest_when ?? "");
	return api
		.post<ScenarioAdminAssetUpload>(
			`/scenario/admin/packs/${packKey}/assets` as ApiPath,
			form,
		)
		.then((r) => r.data);
};

export const deleteAdminScenarioAsset = (packKey: string, assetId: string) =>
	api
		.delete<{ key: string; revision_no: number; assets: ScenarioAdminAsset[] }>(
			`/scenario/admin/packs/${packKey}/assets/${assetId}` as ApiPath,
		)
		.then((r) => r.data);

/**
 * 管理侧资源预览地址：**按 pack key** 取字节（不是修订 id），可直接交给 `AuthImage`。
 */
export function adminScenarioAssetSrc(packKey: string, assetId: string): string {
	return `/scenario/admin/packs/${encodeURIComponent(packKey)}/assets/${encodeURIComponent(assetId)}`;
}

export const listAdminScenarioSessions = (
	query: ScenarioAdminSessionQuery = {},
) =>
	api
		.get<ScenarioAdminSessionList>(
			"/scenario/admin/sessions" satisfies ApiPath as string,
			{
				params: {
					pack_key: query.pack_key || undefined,
					status: query.status || undefined,
					limit: query.limit,
					offset: query.offset,
				},
			},
		)
		.then((r) => r.data);

export const getAdminScenarioSession = (sessionId: number) =>
	api
		.get<ScenarioAdminSessionDetail>(
			`/scenario/admin/sessions/${sessionId}` as ApiPath,
		)
		.then((r) => r.data);

/** 某个病例下 DM 生成物的**服务端分页**（`total` 是该病例下的总数）。 */
export const listAdminGeneratedAssets = (
	packKey: string,
	query: ScenarioGeneratedQuery = {},
) =>
	api
		.get<ScenarioGeneratedList>(
			`/scenario/admin/packs/${packKey}/generated` as ApiPath,
			{
				params: {
					limit: query.limit ?? 20,
					offset: query.offset ?? 0,
					session_id: query.session_id ?? undefined,
				},
			},
		)
		.then((r) => r.data);

export const deleteAdminGeneratedAsset = (id: number) =>
	api
		.delete<{ deleted: number; id: number }>(
			`/scenario/admin/generated/${id}` as ApiPath,
		)
		.then((r) => r.data);

/** 生成物预览地址（管理侧，需登录态）：可直接交给 `AuthImage`。 */
export const adminGeneratedAssetSrc = (id: number) =>
	`/scenario/admin/generated/${id}/content`;

export const getAdminScenarioStats = () =>
	api
		.get<ScenarioAdminStats>("/scenario/admin/stats" satisfies ApiPath as string)
		.then((r) => r.data);

/**
 * 把后端给的图片 URL 归一成可以交给 `AuthImage` 的路径。
 *
 * 后端 `_asset_url` 返回值带 `/api` 前缀，而 axios 实例的 `baseURL` 就是 `/api`
 * ——直接透传会打成 `/api/api/...`。这里只做前缀剥离，不猜其他形状（不是本域的 URL 原样返回）。
 */
export function scenarioImageSrc(url: string): string {
	return url.startsWith("/api/") ? url.slice(4) : url;
}

/**
 * 功能（kill switch）关闭时整个 `/api/scenario/**` 命名空间返回 **404**（不是 403），
 * 因此 404 只有两个含义：功能未开启，或会话不属于本人。
 */
export function isScenarioUnavailable(e: unknown): boolean {
	return isAxiosError(e) && e.response?.status === 404;
}
