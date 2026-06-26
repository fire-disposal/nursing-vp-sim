/** Shared date formatting — single source of truth for zh-CN display. */

type DateInput = string | number | Date | null | undefined;

function toValidDate(value: DateInput): Date | null {
	if (value == null || value === "") return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/** "2026/6/25" — zh-CN date only. Empty string for invalid/empty input. */
export function formatDate(value: DateInput): string {
	const d = toValidDate(value);
	return d ? d.toLocaleDateString("zh-CN") : "";
}

/** "2026/6/25 14:30:00" — zh-CN date + time. Empty string for invalid/empty input. */
export function formatDateTime(value: DateInput): string {
	const d = toValidDate(value);
	return d ? d.toLocaleString("zh-CN") : "";
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
