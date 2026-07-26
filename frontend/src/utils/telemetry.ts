/** Frontend error telemetry — lightweight, fire-and-forget.
 *
 * Uses `navigator.sendBeacon` (non-blocking, survives page unload).
 * Errors are batched in-memory and flushed every 10s or when 5 accumulate.
 * Payload ~200 bytes per error. Rate limited server-side (5 req/min per IP).
 *
 * Usage:
 *   import { reportError } from "@/utils/telemetry";
 *   reportError("AbortError", "请求超时，请重试", "/api/chat/285/message/stream");
 */

const ENDPOINT = "/api/telemetry";
const FLUSH_INTERVAL = 10_000; // 10s batch window
const MAX_BATCH = 5;          // flush early when N errors accumulate

interface ErrorEntry {
  type: string;
  message: string;
  url: string;
  user_id: number;
  ua: string;
}

let buffer: ErrorEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let userId: number = 0;
const ua = navigator.userAgent.slice(0, 200);

export function setTelemetryUserId(id: number): void {
  userId = id;
}

function flush(): void {
  if (buffer.length === 0) return;
  const payload = JSON.stringify({ errors: buffer });
  buffer = [];
  if (timer) { clearTimeout(timer); timer = null; }
  navigator.sendBeacon(ENDPOINT, payload);
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(flush, FLUSH_INTERVAL);
}

export function reportError(type: string, message: string, url: string = ""): void {
  // Strip token from URLs to avoid leaking credentials in telemetry
  const cleanUrl = url.replace(/([?&]token=)[^&]*/i, "$1***");
  buffer.push({
    type: type.slice(0, 200),
    message: message.slice(0, 1000),
    url: cleanUrl.slice(0, 500),
    user_id: userId,
    ua,
  });
  if (buffer.length >= MAX_BATCH) {
    flush();
  } else {
    scheduleFlush();
  }
}
