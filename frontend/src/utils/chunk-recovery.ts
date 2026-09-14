/**
 * 每个标签页、每个构建最多因分块失败自动刷新一次。
 * sessionStorage 无法确认写入时不刷新；普通 API 网络错误不触发恢复。
 * 不吞掉错误，让懒加载路由的 ErrorBoundary 保留可见错误和手动刷新入口。
 */

/** sessionStorage 中记录「当前构建已自动刷新过」的键。 */
const GUARD_KEY = "nursing:chunk-reload-guard";

/** 各浏览器对动态模块加载失败的拒绝报文（普通 fetch 失败不在其中）。 */
const CHUNK_FAILURE_PATTERNS: readonly RegExp[] = [
	/dynamically imported module/i, // Chrome/Edge：Failed to fetch…；Firefox：error loading…
	/importing a module script failed/i, // Safari
	/unable to preload css for/i, // Vite 预加载 CSS 失败（与 chunk 同一预加载管线）
];

/** 取出「动态模块加载失败」的报文；不是 chunk 失败（如接口 fetch 失败）返回 null。 */
function chunkFailureMessage(reason: unknown): string | null {
	let message = "";
	if (typeof reason === "string") {
		message = reason;
	} else if (reason && typeof reason === "object" && "message" in reason) {
		message = String((reason as { message?: unknown }).message ?? "");
	}
	return CHUNK_FAILURE_PATTERNS.some((pattern) => pattern.test(message))
		? message
		: null;
}

/** 消耗本标签页当前构建的自动刷新额度；额度已用或存储不可用 → false。 */
function consumeReloadBudget(): boolean {
	// 构建标识 = 入口 module script 的 URL（重新部署 → 新 hash 的新 URL），
	// import.meta.url 仅作异常嵌入场景的兜底。
	const entry = document.querySelector<HTMLScriptElement>(
		'script[type="module"][src]',
	);
	const buildId = entry?.src || import.meta.url;
	try {
		if (window.sessionStorage.getItem(GUARD_KEY) === buildId) return false;
		window.sessionStorage.setItem(GUARD_KEY, buildId);
		// 隐私模式下写入可能静默失败：回读确认，否则宁可不刷新
		return window.sessionStorage.getItem(GUARD_KEY) === buildId;
	} catch {
		return false;
	}
}

/** 安装 chunk 失败恢复监听，返回卸载函数。
 *
 * @param reload 自动刷新入口，默认 `window.location.reload()`（测试注入点）。
 */
export function installChunkRecovery(
	reload: () => void = () => window.location.reload(),
): () => void {
	const recover = (source: string, reason: unknown) => {
		if (!consumeReloadBudget()) {
			console.error(
				`[chunkRecovery] ${source}：chunk 仍加载失败，已停止自动刷新，请手动刷新页面`,
				reason,
			);
			return;
		}
		console.warn(`[chunkRecovery] ${source}：chunk 加载失败，自动刷新一次`, reason);
		reload();
	};

	const onPreloadError = (event: VitePreloadErrorEvent) => {
		recover("vite:preloadError", event.payload);
	};

	const onUnhandledRejection = (event: PromiseRejectionEvent) => {
		if (!chunkFailureMessage(event.reason)) return;
		recover("unhandledrejection", event.reason);
	};

	window.addEventListener("vite:preloadError", onPreloadError);
	window.addEventListener("unhandledrejection", onUnhandledRejection);
	return () => {
		window.removeEventListener("vite:preloadError", onPreloadError);
		window.removeEventListener("unhandledrejection", onUnhandledRejection);
	};
}
