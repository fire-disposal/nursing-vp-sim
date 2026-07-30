/** Frontend error telemetry — lightweight, fire-and-forget.
 *
 * Uses `navigator.sendBeacon` (non-blocking, survives page unload).
 * Errors are batched in-memory and flushed every 10s or when 5 accumulate.
 * Payload is sanitized before send. Rate limited server-side (5 req/min per IP).
 */

const ENDPOINT = "/api/telemetry";
const FLUSH_INTERVAL = 10_000;
const MAX_BATCH = 5;

interface ErrorMeta {
	source?: string;
	componentStack?: string;
}

interface ErrorEntry {
	type: string;
	message: string;
	url: string;
	user_id: number;
	ua: string;
	source: string;
	component_stack: string;
}

let buffer: ErrorEntry[] = [];
let timer: number | null = null;
let userId = 0;
let globalTelemetryInstalled = false;
const ua = navigator.userAgent.slice(0, 200);

export function setTelemetryUserId(id: number): void {
	userId = id;
}

function sanitizeUrl(url: string): string {
	return url
		.replace(/([?&](token|access_token|refresh_token)=)[^&]*/gi, "$1***")
		.slice(0, 500);
}

function flush(): void {
	if (buffer.length === 0) return;
	const payload = JSON.stringify({ errors: buffer });
	buffer = [];
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
}

function scheduleFlush(): void {
	if (timer) return;
	timer = window.setTimeout(flush, FLUSH_INTERVAL);
}

export function reportError(type: string, message: string, url = "", meta: ErrorMeta = {}): void {
	buffer.push({
		type: type.slice(0, 200),
		message: message.slice(0, 1000),
		url: sanitizeUrl(url || window.location.pathname),
		user_id: userId,
		ua,
		source: (meta.source || "").slice(0, 120),
		component_stack: (meta.componentStack || "").slice(0, 1000),
	});
	if (buffer.length >= MAX_BATCH) {
		flush();
	} else {
		scheduleFlush();
	}
}

export function installGlobalTelemetry(): void {
	if (globalTelemetryInstalled) return;
	globalTelemetryInstalled = true;

	window.addEventListener("error", (event) => {
		const message = event.error instanceof Error ? event.error.message : event.message || "window error";
		reportError(event.error?.name || "WindowError", message, window.location.pathname, { source: "window.error" });
	});

	window.addEventListener("unhandledrejection", (event) => {
		const reason = event.reason;
		const message = reason instanceof Error ? reason.message : String(reason || "unhandled rejection");
		reportError(reason?.name || "UnhandledRejection", message, window.location.pathname, {
			source: "unhandledrejection",
		});
	});
}
