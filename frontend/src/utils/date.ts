/**
 * Shared date formatting — single source of truth for zh-CN display.
 *
 * **时区固定为上海**：后端一律以 UTC 存（timestamptz），但受众在学校；
 * 若按浏览器本地时区渲染，出差/海外用户会看到与自己认知不一致的时间
 * （2026-09-26 时区对齐，见 docs/ops/timezone-alignment.md）。
 */
export const APP_TIME_ZONE = "Asia/Shanghai";

type DateInput = string | number | Date | null | undefined;

function toValidDate(value: DateInput): Date | null {
	if (value == null || value === "") return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/** 上海时区下的当前小时（0–23）：问候语等"按小时"的判断也要跟着时区，否则海外用户会看到"晚上好"却是上午。 */
export function shanghaiHour(at: DateInput = new Date()): number {
	const d = toValidDate(at) ?? new Date();
	const hour = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, hour: "2-digit", hour12: false })
		.formatToParts(d)
		.find((x) => x.type === "hour")?.value;
	return Number(hour ?? String(d.getHours()));
}

/**
 * 上海日历下的日期键 `YYYY-MM-DD`（可加/减天数）。
 *
 * 用途：按天聚合的请求参数与图表标签（如"本周"的周一…周日）。**日期运算在 UTC 上做**，
 * 因此与浏览器时区彻底无关 —— 海外用户不会因为本地区时差把"本周"算错一天。
 */
export function shanghaiDateKey(base: DateInput = new Date(), offsetDays = 0): string {
	const d = toValidDate(base) ?? new Date();
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: APP_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(d);
	const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? "0");
	const utcMidnight = Date.UTC(get("year"), get("month") - 1, get("day")) + offsetDays * 86_400_000;
	const shifted = new Date(utcMidnight);
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** "2026/6/25" — zh-CN date only. Empty string for invalid/empty input. */
export function formatDate(value: DateInput): string {
	const d = toValidDate(value);
	return d ? d.toLocaleDateString("zh-CN", { timeZone: APP_TIME_ZONE }) : "";
}

/** "2026/6/25 14:30:00" — zh-CN date + time. Empty string for invalid/empty input. */
export function formatDateTime(value: DateInput): string {
	const d = toValidDate(value);
	return d ? d.toLocaleString("zh-CN", { timeZone: APP_TIME_ZONE }) : "";
}

/** "06-25 14:30" — 紧凑时间戳（按上海时区），用于窄栏的提交时间展示。 */
export function formatShortDateTime(value: DateInput): string {
	const d = toValidDate(value);
	if (!d) return "";
	const parts = new Intl.DateTimeFormat("zh-CN", {
		timeZone: APP_TIME_ZONE,
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(d);
	const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "00";
	return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** ISO/Date → value for `<input type="datetime-local">` (local time, no seconds). */
export function toDatetimeLocal(value: DateInput): string {
	const d = toValidDate(value);
	if (!d) return "";
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `<input type="datetime-local">` value → ISO string (or null when empty/invalid). */
export function fromDatetimeLocal(local: string | null | undefined): string | null {
	if (!local) return null;
	const d = new Date(local);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
