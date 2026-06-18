export function getApiErrorMessage(e: unknown, fallback = "操作失败"): string {
	const err = e as { response?: { data?: { detail?: string } }; message?: string };
	return err.response?.data?.detail || err.message || fallback;
}
