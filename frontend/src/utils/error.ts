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
	return err.message || fallback;
}
