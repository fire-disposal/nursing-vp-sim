export function getApiErrorMessage(e: unknown, fallback = "操作失败"): string {
	const err = (e ?? {}) as {
		response?: { data?: { detail?: unknown } };
		message?: string;
	};
	const detail = err.response?.data?.detail;
	if (typeof detail === "string") return detail;
	if (Array.isArray(detail)) {
		return detail.map((d: { msg?: string; loc?: string[] }) => {
			const field = (d.loc || []).filter((l: string) => l !== "body").join(".");
			return field ? `${field}: ${d.msg}` : d.msg;
		}).join("; ") || fallback;
	}
	// 业务错误的结构化 detail（如再练习 409 的 {code, kind, message}）：服务端已给可读文案
	if (detail && typeof detail === "object" && "message" in detail) {
		const message = detail.message;
		if (typeof message === "string" && message) return message;
	}
	return err.message || fallback;
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
