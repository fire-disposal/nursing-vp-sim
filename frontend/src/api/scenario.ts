import { isAxiosError } from "axios";
import useAuthStore from "@/stores/authStore";
import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

// Public wire shapes have one owner: the generated backend schema.
export type ScenarioPackSummary = Schemas["ScenarioPackSummary"];
export type ScenarioMessage = Schemas["ScenarioMessage"];
export type ScenarioTarget = Schemas["TargetRef"];
export type ScenarioAffordance = Schemas["ScenarioAffordance"];
export type ScenarioActor = Schemas["ScenarioActor"];
export type ScenarioHudSlot = Schemas["ScenarioHudSlot"];
export type ScenarioSituation = Schemas["ScenarioSituation"];
export type ScenarioTimelineEntry = Schemas["ScenarioTimelineEntry"];
export type ScenarioDim = Schemas["ScenarioDim"];
export type ScenarioAsset = Schemas["ScenarioAsset"];
export type ScenarioImage = Schemas["ScenarioImage"];
export type ScenarioBoardEntry = Schemas["ScenarioBoardEntry"];
export type ScenarioBoardSection = Schemas["ScenarioBoardSection"];
export type ScenarioBoard = Schemas["ScenarioBoard"];
export type ScenarioDeviceChannel = Schemas["ScenarioDeviceChannel"];
export type ScenarioDevice = Schemas["ScenarioDevice"];
export type ScenarioView = Schemas["ScenarioView"];
export type ScenarioCriterion = Schemas["ScenarioCriterion"];
export type ScenarioScore = Schemas["ScenarioScore"];
export type ScenarioReport = Schemas["ScenarioReport"];
export type ScenarioOpenSessionRequest = Schemas["ScenarioOpenSessionRequest"];
export type ScenarioArchiveRef = Schemas["ScenarioArchiveRef"];
export type ScenarioSessionResponse = Schemas["ScenarioSessionResponse"];
export type ScenarioSessionState = Schemas["ScenarioSessionState"];
export type ScenarioTurnRequest = Schemas["ScenarioTurnRequest"];
export type ScenarioTurnResult = Schemas["ScenarioTurnResult"];
export type ScenarioRequestLookup = Schemas["ScenarioRequestLookup"];
export type ScenarioSsePhase = Schemas["ScenarioSsePhase"];
export type ScenarioSseDelivery = Schemas["ScenarioSseDelivery"];
export type ScenarioSseCommitted = Schemas["ScenarioSseCommitted"];
export type ScenarioSseError = Schemas["ScenarioSseError"];
/** SSE 阶段词表（封闭枚举，来自生成物；前端只翻译，不自造阶段名）。 */
export type ScenarioTurnPhase = ScenarioSsePhase["phase"];
export type ScenarioCloseResponse = Schemas["ScenarioCloseResponse"];
export type ScenarioCloseRequest = Schemas["ScenarioCloseRequest"];
export type ScenarioErrorInfo = Schemas["ScenarioErrorInfo"];
/** Composer draft: request identity is assigned only when submitted. */
export type ScenarioActionInput = Omit<ScenarioTurnRequest, "request_id" | "expected_seq">;
export type ScenarioSessionRow = Schemas["ScenarioSessionRow"];
export type ScenarioAdminSessionRow = Schemas["ScenarioAdminSessionRow"];
export type ScenarioAdminRevision = Schemas["ScenarioAdminRevision"];
export type ScenarioAdminOverview = Schemas["ScenarioAdminOverview"];
export type ScenarioAdminAsset = Schemas["ScenarioAdminAsset"];
export type ScenarioAdminPack = Schemas["ScenarioAdminPack"];
export type ScenarioAdminPackUpload = Schemas["ScenarioAdminPackUpload"];
export type ScenarioAdminAssetUpload = Schemas["ScenarioAdminAssetUpload"];
export type ScenarioAdminEvent = Schemas["ScenarioAdminEvent"];
export type ScenarioAdminSessionList = Schemas["ScenarioAdminSessionList"];
export type ScenarioAdminSessionDetail = Schemas["ScenarioAdminSessionDetail"];
export type ScenarioAdminFocusTurn = Schemas["ScenarioAdminFocusTurn"];
export type ScenarioAdminTurnReplay = Schemas["ScenarioAdminTurnReplay"];
export type ScenarioAdminStatsBucket = Schemas["ScenarioAdminStatsBucket"];
export type ScenarioAdminStats = Schemas["ScenarioAdminStats"];
export type ScenarioGeneratedAsset = Schemas["ScenarioGeneratedAsset"];
export type ScenarioGeneratedList = Schemas["ScenarioGeneratedList"];
export type ScenarioPackProblem = Schemas["ScenarioPackProblem"];
export type ScenarioPackValidation = Schemas["ScenarioPackValidation"];
export type ScenarioAdminPackSource = Schemas["ScenarioAdminPackSource"];
export type ScenarioArchiveSummary = Schemas["ScenarioArchiveSummary"];
export type ScenarioArchiveList = Schemas["ScenarioArchiveList"];
export type ScenarioArchiveRaw = Schemas["ScenarioArchiveRaw"];
export type ScenarioArchiveDetail = Schemas["ScenarioArchiveDetail"];
export type ScenarioPackState = Schemas["PackState"];
export type ScenarioAnchor = Schemas["Anchor"];
export type ScenarioChannelStatus = ScenarioDeviceChannel["status"];
export type ScenarioDeviceKind = ScenarioDevice["kind"];
export interface ScenarioGeneratedQuery { limit?: number; offset?: number; session_id?: number | null }
export interface ScenarioAdminSessionQuery { pack_key?: string | null; status?: string | null; limit?: number; offset?: number }
/** 归档列表的查询参数（后端是 `Query(...)`，不是请求体模型 → 前端自己声明，见 handoff §13.4）。 */
export interface ScenarioAdminArchiveQuery { pack_key?: string | null; limit?: number; offset?: number }

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
	payload: ScenarioOpenSessionRequest = { trial: false },
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

export const postScenarioTurn = (sessionId: number, request: ScenarioTurnRequest) =>
	api.post<ScenarioTurnResult>(`/scenario/sessions/${sessionId}/turns` as ApiPath, request).then((r) => r.data);

export const getScenarioRequest = (sessionId: number, requestId: string) =>
	api.get<ScenarioRequestLookup>(`/scenario/sessions/${sessionId}/requests/${encodeURIComponent(requestId)}` as ApiPath).then((r) => r.data);

// --------------------------------------------------------------------------- //
// 流式回合（SSE）
//
// `EventSource` 只支持 GET，而这里要 POST 一个动作，所以用 `fetch` + `getReader()`
// 自己按行切（与 `./stream.ts` 的做法一致）。
// --------------------------------------------------------------------------- //

/**
 * SSE 的四种事件：`kind` 是前端加上的传输判别键（SSE 把事件名放在 `event:` 行，
 * `data:` 里没有它），载荷本身**逐字**取生成物里的 `ScenarioSse{Phase,Delivery,Committed,Error}`。
 *
 * **`delivery` 是已通过结构校验但尚未提交的草稿**：无论它看起来多完整，都不代表世界已经变化，
 * 一律不得渲染成事实（失败回合也可能先收到 delivery 再收到 error）。提交前学生只看到
 * 阶段状态与待发送的自己的消息（`docs/23` §4.5）。
 */
export type ScenarioStreamEvent =
	| ({ kind: "phase" } & ScenarioSsePhase)
	| ({ kind: "delivery" } & ScenarioSseDelivery)
	| ({ kind: "committed" } & ScenarioSseCommitted)
	| ({ kind: "error" } & ScenarioSseError);

/** A broken stream says nothing about commit status. The caller must look up the request. */
export async function streamScenarioTurn(
	sessionId: number,
	request: ScenarioTurnRequest,
	onEvent: (event: ScenarioStreamEvent) => void,
	signal?: AbortSignal,
): Promise<void> {
	const response = await fetch(`${api.defaults.baseURL ?? ""}/scenario/sessions/${sessionId}/turns/stream`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${useAuthStore.getState().token ?? ""}` },
		body: JSON.stringify(request),
		signal,
	});
	if (!response.ok) {
		const body = await response.json().catch(() => null);
		throw new ScenarioHttpError(response.status, body?.detail ?? { code: "http_error", message: `请求失败（${response.status}）` });
	}
	if (!response.body) throw new Error("连接未返回可读结果");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const consume = (frame: string) => {
		const lines = frame.split("\n");
		const kind = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
		if (!kind || !["phase", "delivery", "committed", "error"].includes(kind)) return;
		const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
		onEvent({ ...JSON.parse(data), kind } as ScenarioStreamEvent);
	};
	try {
		while (true) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
			let boundary = buffer.indexOf("\n\n");
			while (boundary !== -1) {
				consume(buffer.slice(0, boundary));
				buffer = buffer.slice(boundary + 2);
				boundary = buffer.indexOf("\n\n");
			}
			if (done) break;
		}
		if (buffer.trim()) consume(buffer);
	} finally {
		reader.releaseLock();
	}
}

export class ScenarioHttpError extends Error {
	constructor(readonly status: number, readonly detail: ScenarioErrorInfo) {
		super(detail.message);
		this.name = "ScenarioHttpError";
	}
}

export const closeScenarioSession = (sessionId: number, request: ScenarioCloseRequest) =>
	api
		.post<ScenarioCloseResponse>(
			`/scenario/sessions/${sessionId}/close` as ApiPath,
			request,
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
	payload: Schemas["ScenarioPackPatchRequest"],
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

// --------------------------------------------------------------------------- //
// 场景编辑器（管理侧「编辑」块）
//
// pack 内容是一棵普通 JSON 树：形状由后端的加载期校验负责，前端**不复刻**校验器
// （`POST .../validate` 与安装走同一套）。这里只声明 UI 消费的键。
// --------------------------------------------------------------------------- //

/** pack 内容里的一个 JSON 值（编辑器按普通树读写）。 */
export type ScenarioPackValue =
	| string
	| number
	| boolean
	| null
	| ScenarioPackValue[]
	| { [key: string]: ScenarioPackValue };

/** 一份 pack 内容（顶层是一张表）。 */
export type ScenarioPackDoc = { [key: string]: ScenarioPackValue };


/** 编辑器：读某个病例某一修订的原始内容（`revisionId` 省略 = 最新修订）。 */
export const getAdminScenarioPackSource = (packKey: string, revisionId?: number) =>
	api
		.get<ScenarioAdminPackSource>(
			`/scenario/admin/packs/${packKey}/source` as ApiPath,
			revisionId === undefined ? undefined : { params: { revision_id: revisionId } },
		)
		.then((r) => r.data);

/** 编辑器：保存前校验（失败时每条问题都带字段路径）。 */
export const validateAdminScenarioPack = (packKey: string, content: ScenarioPackDoc) =>
	api
		.post<ScenarioPackValidation>(
			`/scenario/admin/packs/${packKey}/validate` as ApiPath,
			{ content },
		)
		.then((r) => r.data);

/** 编辑器保存：**追加新修订**（内容未变则幂等复用，返回 `created=false`）。 */
export const saveAdminScenarioPackRevision = (
	packKey: string,
	content: ScenarioPackDoc,
	note: string,
) =>
	api
		.post<ScenarioAdminPackUpload>(
			`/scenario/admin/packs/${packKey}/revisions` as ApiPath,
			{ content, note },
		)
		.then((r) => r.data);

export const convertAdminScenarioPack = (packKey: string, revisionId: number) =>
	api.post<Schemas["ScenarioAdminPackConvert"]>(`/scenario/admin/packs/${packKey}/convert` as ApiPath, { revision_id: revisionId }).then((r) => r.data);

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

/** 历史归档（**只读**）：机制切换前的旧局投影，按原会话 id 唯一。 */
export const listAdminScenarioArchives = (
	query: ScenarioAdminArchiveQuery = {},
) =>
	api
		.get<ScenarioArchiveList>(
			"/scenario/admin/archives" satisfies ApiPath as string,
			{
				params: {
					pack_key: query.pack_key ?? undefined,
					limit: query.limit,
					offset: query.offset,
				},
			},
		)
		.then((r) => r.data);

/** 归档详情：`report` 是新形状或 null；旧局原报告原样放在 `legacy_report`，**绝不重算**。 */
export const getAdminScenarioArchive = (sessionId: number) =>
	api
		.get<ScenarioArchiveDetail>(
			`/scenario/admin/archives/${sessionId}` as ApiPath,
		)
		.then((r) => r.data);

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
export function scenarioImageSrc(url: string | null | undefined): string {
	if (!url) return "";
	return url.startsWith("/api/") ? url.slice(4) : url;
}

/**
 * 功能（kill switch）关闭时整个 `/api/scenario/**` 命名空间返回 **404**（不是 403），
 * 因此 404 只有两个含义：功能未开启，或会话不属于本人。
 */
export function isScenarioUnavailable(e: unknown): boolean {
	return isAxiosError(e) && e.response?.status === 404;
}
