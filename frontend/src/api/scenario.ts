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
export type ScenarioSessionResponse = Schemas["ScenarioSessionResponse"];
export type ScenarioSessionState = Schemas["ScenarioSessionState"];
export type ScenarioTurnRequest = Schemas["ScenarioTurnRequest"];
export type ScenarioTurnResult = Schemas["ScenarioTurnResult"];
export type ScenarioRequestLookup = Schemas["ScenarioRequestLookup"];
export type ScenarioSsePhase = Schemas["ScenarioSsePhase"];
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
export type ScenarioAdminOverview = Schemas["ScenarioAdminOverview"];
export type ScenarioAdminAsset = Schemas["ScenarioAdminAsset"];
export type ScenarioAdminPack = Schemas["ScenarioAdminPack"];
export type ScenarioAdminPackUpload = Schemas["ScenarioAdminPackUpload"];
/** 导入一个病例的结果：`problems` 是**宽容导入**的提示（不是失败，失败是 422）。 */
export type ScenarioAdminPackImport = Schemas["ScenarioAdminPackImport"];
export type ScenarioAdminPackDelete = Schemas["ScenarioAdminPackDelete"];
export type ScenarioAdminAssetUpload = Schemas["ScenarioAdminAssetUpload"];
/**
 * 撤下一张资源的结果（后端这条路由没有声明 `response_model`，生成物里是裸 dict →
 * 前端按真实返回的字段声明，见 `router.admin_delete_asset`）。
 */
export interface ScenarioAdminAssetDeleteResult {
	key: string;
	version: number;
	assets: ScenarioAdminAsset[];
}
export type ScenarioAdminEvent = Schemas["ScenarioAdminEvent"];
export type ScenarioAdminSessionList = Schemas["ScenarioAdminSessionList"];
export type ScenarioAdminSessionDetail = Schemas["ScenarioAdminSessionDetail"];
export type ScenarioAdminTurnReplay = Schemas["ScenarioAdminTurnReplay"];
export type ScenarioAdminStatsBucket = Schemas["ScenarioAdminStatsBucket"];
export type ScenarioAdminStats = Schemas["ScenarioAdminStats"];
export type ScenarioPackProblem = Schemas["ScenarioPackProblem"];
export type ScenarioPackValidation = Schemas["ScenarioPackValidation"];
/** 编辑器读/存共用的一份响应：当前内容 + 版本 + 遗留问题。 */
export type ScenarioPackContent = Schemas["ScenarioPackContent"];
export type ScenarioNewPackRequest = Schemas["ScenarioNewPackRequest"];
export type ScenarioChannelStatus = ScenarioDeviceChannel["status"];
export type ScenarioDeviceKind = ScenarioDevice["kind"];
export interface ScenarioAdminSessionQuery { pack_key?: string | null; status?: string | null; limit?: number; offset?: number }

/** 上传请求体：multipart 的字段名与生成物一致，只有 `file` 在浏览器里是 `File`（生成物是二进制字符串）。 */
export type ScenarioAssetUploadInput = Omit<
	Schemas["Body_admin_upload_asset_api_scenario_admin_packs__pack_key__assets_post"],
	"file"
> & { file: File };

/** 替换一张已声明的图片：`asset_id` 在路径上，请求体只有字节与文案。 */
export type ScenarioAssetReplaceInput = Omit<
	Schemas["Body_admin_replace_asset_api_scenario_admin_packs__pack_key__assets__asset_id__post"],
	"file"
> & { file: File };

// --------------------------------------------------------------------------- //
// 调用
// --------------------------------------------------------------------------- //

export const listScenarioPacks = () =>
	api
		.get<ScenarioPackSummary[]>("/scenario/packs" satisfies ApiPath as string)
		.then((r) => r.data);

/** 开新局**只按 `pack_key`**：后端把这份病例的当前内容快照进会话行，之后改病例不影响这一局。 */
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
 * SSE 的三种事件：`kind` 是前端加上的传输判别键（SSE 把事件名放在 `event:` 行，
 * `data:` 里没有它），载荷本身**逐字**取生成物里的 `ScenarioSse{Phase,Committed,Error}`。
 *
 * 只有这三种：服务端曾多发一个"已校验但未提交的草稿"事件（`delivery`），前端从收到的那一刻
 * 就把它丢掉、从不渲染——**发出来即被丢弃的东西不该留在协议里**，已整条删除（`docs/23` §4.5）。
 */
export type ScenarioStreamEvent =
	| ({ kind: "phase" } & ScenarioSsePhase)
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
		if (!kind || !["phase", "committed", "error"].includes(kind)) return;
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

/**
 * 导入一个病例：一个 zip，或一个目录的全部文件。
 *
 * 目录上传时后端按 `filename` 里的**相对路径**定位 `case.toml` 所在的根目录，
 * 所以每个文件必须带上 `webkitRelativePath`（zip 走单字段，路径由后端自己解）。
 */
export const importAdminScenarioPack = (files: File[]) => {
	const form = new FormData();
	for (const file of files) {
		form.append("files", file, file.webkitRelativePath || file.name);
	}
	return api
		.post<ScenarioAdminPackImport>(
			"/scenario/admin/packs/import" satisfies ApiPath as string,
			form,
		)
		.then((r) => r.data);
};

/** 标准模板（后端硬编码的最小可运行病例：`case.toml` + `case.md`）——返回 zip 字节，落盘由调用方做。 */
export const downloadAdminStandardCase = (key: string, title: string) =>
	api.get<Blob>("/scenario/admin/cases/standard.zip" satisfies ApiPath as string, {
		params: { key: key.trim() || "new-case", title: title.trim() || "新病例" },
		responseType: "blob",
	});

/** 导出这份病例为一个文件夹压缩包（`case.toml` + `case.md` + `img/`，**无损**）——返回 zip 字节。 */
export const exportAdminScenarioPack = (packKey: string) =>
	api.get<Blob>(
		`/scenario/admin/packs/${packKey}/export.zip` as ApiPath,
		{ responseType: "blob" },
	);

// --------------------------------------------------------------------------- //
// 病例管理（系统侧闭环：新建 / 复制 / 上架下架 / 删除）
// --------------------------------------------------------------------------- //

/** 新建一个**最小可运行**的病例骨架（不是空对象）：拿到后直接用编辑器改。 */
export const createBlankScenarioPack = (payload: ScenarioNewPackRequest) =>
	api
		.post<ScenarioAdminPackUpload>(
			"/scenario/admin/packs/blank" satisfies ApiPath as string,
			payload,
		)
		.then((r) => r.data);

/** 复制一个病例（做变式）：新病例的第 1 个版本就是源病例当前版本的内容。 */
export const duplicateAdminScenarioPack = (
	packKey: string,
	payload: ScenarioNewPackRequest,
) =>
	api
		.post<ScenarioAdminPackUpload>(
			`/scenario/admin/packs/${packKey}/duplicate` as ApiPath,
			payload,
		)
		.then((r) => r.data);

/** 上架：学生列表从此能看到它（校验不过会返回 422 problems[]）。两个方向都幂等。 */
export const publishAdminScenarioPack = (packKey: string) =>
	api
		.post<ScenarioAdminPack>(
			`/scenario/admin/packs/${packKey}/publish` as ApiPath,
			{},
		)
		.then((r) => r.data);

/** 下架：学生不再能开新局；已有会话与记录照常。 */
export const unpublishAdminScenarioPack = (packKey: string) =>
	api
		.post<ScenarioAdminPack>(
			`/scenario/admin/packs/${packKey}/unpublish` as ApiPath,
			{},
		)
		.then((r) => r.data);

/** 删除病例：只有**没有任何会话**时才允许；`confirm` 是防手滑，二次确认由界面负责。 */
export const deleteAdminScenarioPack = (packKey: string) =>
	api
		.delete<ScenarioAdminPackDelete>(
			`/scenario/admin/packs/${packKey}` as ApiPath,
			{ params: { confirm: true } },
		)
		.then((r) => r.data);

/** 上传一张场景图片：存字节 + 把声明写进当前内容（声明变了 version 就 +1）。 */
export const uploadAdminScenarioAsset = (
	packKey: string,
	payload: ScenarioAssetUploadInput,
) => {
	const form = new FormData();
	form.append("asset_id", payload.asset_id);
	form.append("file", payload.file);
	form.append("title", payload.title ?? "");
	form.append("alt", payload.alt ?? "");
	return api
		.post<ScenarioAdminAssetUpload>(
			`/scenario/admin/packs/${packKey}/assets` as ApiPath,
			form,
		)
		.then((r) => r.data);
};

/** 替换一张已声明的图片：`asset_id` 不变（内容里的 JSON 引用不用改），只换字节与文案。 */
export const replaceAdminScenarioAsset = (
	packKey: string,
	assetId: string,
	payload: ScenarioAssetReplaceInput,
) => {
	const form = new FormData();
	form.append("file", payload.file);
	form.append("title", payload.title ?? "");
	form.append("alt", payload.alt ?? "");
	return api
		.post<ScenarioAdminAssetUpload>(
			`/scenario/admin/packs/${packKey}/assets/${encodeURIComponent(assetId)}` as ApiPath,
			form,
		)
		.then((r) => r.data);
};

/** 撤下一张资源：声明从当前内容里去掉，字节一并删除。 */
export const deleteAdminScenarioAsset = (packKey: string, assetId: string) =>
	api
		.delete<ScenarioAdminAssetDeleteResult>(
			`/scenario/admin/packs/${packKey}/assets/${assetId}` as ApiPath,
		)
		.then((r) => r.data);

/**
 * 场景资源地址：**按 pack key** 取字节（不是修订 id），可直接交给 `AuthImage`。
 */
export function scenarioAssetSrc(packKey: string, assetId: string): string {
	return `/scenario/assets/${encodeURIComponent(packKey)}/${encodeURIComponent(assetId)}`;
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

/** 编辑器：读这份病例的**当前内容**（存回去就走 `POST` 同一个端点）。 */
export const getAdminScenarioPackContent = (packKey: string) =>
	api
		.get<ScenarioPackContent>(
			`/scenario/admin/packs/${packKey}/content` as ApiPath,
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

/**
 * 编辑器保存：**覆盖当前内容**（内容未变则幂等复用，不涨 version，返回 `changed=false`）。
 *
 * 校验不过时后端返回 422 + `problems[]`，`changed`/`version` 不会被伪造出来。
 */
export const saveAdminScenarioPackContent = (packKey: string, content: ScenarioPackDoc) =>
	api
		.post<ScenarioPackContent>(
			`/scenario/admin/packs/${packKey}/content` as ApiPath,
			{ content },
		)
		.then((r) => r.data);

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
