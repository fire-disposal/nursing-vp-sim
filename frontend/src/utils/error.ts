const MAX_LISTED_PROBLEMS = 5;

/** 后端有时会甩回英文/机器话（框架默认），这些一律换成人话。 */
const GENERIC_BY_TEXT: Record<string, string> = {
	"not found": "没有找到这个内容",
	"internal server error": "服务端出错了，请稍后重试",
	"bad request": "这次请求不合法",
	forbidden: "没有访问权限",
	unauthorized: "登录状态已失效，请重新登录",
	"method not allowed": "这个操作在这里不被支持",
};

/** 按状态码给人话（拿不到服务端文案时的兜底；比原样吐 JSON 有用得多）。 */
function humanByStatus(status: number | null): string | null {
	if (status === null) return null;
	if (status === 404) return "没有找到这个内容，或这个功能在当前环境里没有开启";
	if (status === 403) return "没有访问权限";
	if (status === 401) return "登录状态已失效，请重新登录";
	if (status === 409) return "这个操作和当前状态冲突，请刷新后重试";
	if (status === 422) return "提交的内容不合法，请检查后重试";
	if (status === 429) return "操作太频繁了，稍等一下再试";
	if (status >= 500) return "服务端出错了，请稍后重试";
	return null;
}

/** 有中日韩文字就算"人话"（后端给小中文文案；英文 pydantic 句子一律不算）。 */
function looksHuman(text: string): boolean {
	return /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/.test(text);
}

/** 字符串形态的明细：可能是服务端写好的文案，也可能是被序列化过的 JSON。 */
function normalizeText(raw: string): string | null {
	const text = raw.trim();
	if (!text) return null;
	if (text.startsWith("{") || text.startsWith("[")) {
		try {
			// 只认里面的 message：problems 属于"细节"，只该出现在管理侧那个函数里
			return detailFrom(JSON.parse(text)).message ?? null;
		} catch {
			return null;
		}
	}
	if (GENERIC_BY_TEXT[text.toLowerCase()]) return GENERIC_BY_TEXT[text.toLowerCase()];
	// 英文技术句子（pydantic 的 "String should have at most 2000 characters" 之类）
	// 不是人话：宁可回退到按状态给的通用文案，也不把它甩到学生脸上
	return looksHuman(text) ? text : null;
}

interface ApiErrorDetail {
	message: string | null;
	problems: string[];
	status: number | null;
}

/**
 * 从 axios/网络异常里取出**结构化**的明细。
 *
 * 认识这几种 detail 形状：字符串（服务端文案或序列化 JSON）、FastAPI 的校验数组、
 * `{message, problems}` 这类业务结构。取不出来的部分一律留空，由调用方兜底。
 */
function detailFrom(detail: unknown, depth = 0): ApiErrorDetail {
	const empty: ApiErrorDetail = { message: null, problems: [], status: null };
	if (depth > 3) return empty; // 防病态嵌套（JSON 里不会自引用，但别赌）
	if (typeof detail === "string") {
		return { ...empty, message: normalizeText(detail) };
	}
	if (Array.isArray(detail)) {
		const parts = detail
			.map((item: { msg?: string; loc?: string[] }) => {
				if (typeof item === "string") return item;
				const field = (item?.loc ?? []).filter((l) => l !== "body").join(".");
				const msg = item?.msg ?? "";
				return field && msg ? `${field}: ${msg}` : msg;
			})
			.filter((item): item is string => typeof item === "string" && item.length > 0);
		// FastAPI 的校验数组默认是英文句子：只有全是人话时才当文案用，
		// 否则交给状态码兜底（学生面不该读 "String should have at most ..."）。
		const human = parts.filter(looksHuman);
		return { ...empty, message: human.length === parts.length ? human.join("；") : null };
	}
	if (detail && typeof detail === "object") {
		const structured = detail as {
			message?: unknown;
			problems?: unknown;
			detail?: unknown;
		};
		const message =
			typeof structured.message === "string"
				? normalizeText(structured.message)
				: null;
		const problems = Array.isArray(structured.problems)
			? structured.problems.filter(
					(item): item is string => typeof item === "string" && item.length > 0,
				)
			: [];
		if (message || problems.length > 0) return { message, problems, status: null };
		// 形如 `{"detail": …}` 的包裹体（被序列化过的原始 body）：再往里走一层
		if (structured.detail !== undefined) {
			return detailFrom(structured.detail, depth + 1);
		}
		return empty;
	}
	return empty;
}

function apiErrorDetail(e: unknown): ApiErrorDetail {
	const err = (e ?? {}) as {
		response?: { data?: { detail?: unknown }; status?: number };
		message?: string;
		code?: string;
	};
	const status = typeof err.response?.status === "number" ? err.response.status : null;
	const parsed = detailFrom(err.response?.data?.detail);
	const offline =
		err.code === "ERR_NETWORK" ||
		err.code === "ECONNREFUSED" ||
		err.code === "ECONNABORTED" ||
		err.code === "ETIMEDOUT" ||
		(typeof navigator !== "undefined" && navigator.onLine === false);
	return {
		message: parsed.message ?? (offline ? "网络已断开，请检查连接后重试" : null),
		problems: parsed.problems,
		status,
	};
}

/**
 * **面向用户**的错误文案：只给人话。
 *
 * 学生面用它。后端原始 JSON、校验数组、英文框架文案都不会原样出现在界面上——
 * 拿不到人话时按状态码兜底（404/403/422/5xx/离线各有一套）。需要后端校验明细的
 * 管理场景请用 `getApiErrorDetail`。
 */
export function getApiErrorMessage(e: unknown, fallback = "操作失败"): string {
	const detail = apiErrorDetail(e);
	if (detail.message) return detail.message;
	return humanByStatus(detail.status) ?? fallback;
}

/**
 * **管理侧**的错误文案：人话 + 后端校验明细（`problems` 逐条列出，最多几条）。
 *
 * 维护者需要知道"哪里不合格"才能改；学生在同样的失败上只需要知道"失败了、能不能重试"，
 * 所以这两件事是两个函数，不是一个开关。
 */
export function getApiErrorDetail(e: unknown, fallback = "操作失败"): string {
	const detail = apiErrorDetail(e);
	const head = detail.message ?? humanByStatus(detail.status) ?? fallback;
	if (detail.problems.length === 0) return head;
	const listed = detail.problems.slice(0, MAX_LISTED_PROBLEMS).join("；");
	const more = detail.problems.length > MAX_LISTED_PROBLEMS ? "；…" : "";
	return `${head}：${listed}${more}`;
}

/**
 * 从「已有进行中训练」的 409 响应里取出冲突记录 id（后端 `detail.record_id`）。
 *
 * 服务端在 `/training/start`、`/training/start-practice` 都以 `{code: "existing_training",
 * record_id, ...}` 表达冲突；调用方据此直接带学生回到那场训练，而不是再报一次错。
 */
export function getExistingTrainingRecordId(e: unknown): number | null {
	if (!e || typeof e !== "object" || !("response" in e)) return null;
	const response = e.response;
	if (!response || typeof response !== "object" || !("data" in response)) return null;
	const data = response.data;
	if (!data || typeof data !== "object" || !("detail" in data)) return null;
	const detail = data.detail;
	if (!detail || typeof detail !== "object" || !("record_id" in detail)) return null;
	const recordId = detail.record_id;
	return typeof recordId === "number" ? recordId : null;
}
