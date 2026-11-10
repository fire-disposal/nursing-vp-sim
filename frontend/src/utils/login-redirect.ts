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

/**
 * 未登录时把当前地址转换成登录入口。
 *
 * 根路径与 `/home` 默认就回首页，不需要把 `next=/` 写进地址栏；
 * 只有真正的深链接才携带回跳目标。
 */
export function loginRedirectPath(pathname: string, search = "", hash = ""): string {
	if (pathname === "/" || pathname === "/home") return "/login";
	return `/login?next=${encodeURIComponent(`${pathname}${search}${hash}`)}`;
}
