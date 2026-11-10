const FALLBACK_PATH = "/home";

/**
 * 登录后的回跳目标：只接受站内绝对路径。
 *
 * 拒绝 `//evil.example`、反斜杠、`javascript:` 以及登录页自身，
 * 避免 `?next=` 被当成开放重定向；其余路径（含 query / hash）原样保留。
 */
export function safeNextPath(raw: string | null | undefined): string {
	const value = raw?.trim();
	if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
		return FALLBACK_PATH;
	}
	if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login#")) {
		return FALLBACK_PATH;
	}
	return value;
}
