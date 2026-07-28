/** Shared CSS class strings for admin pages — single source of truth. */

export const btnPrimary =
	"inline-flex items-center justify-center gap-1.5 px-6 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors border-none cursor-pointer";

export const btnSecondary =
	"inline-flex items-center justify-center gap-1.5 px-6 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors border-none cursor-pointer";

export const statCardClass =
	"bg-card rounded-xl shadow-e1 p-5 border border-border flex items-center gap-3.5";

export const statIconClass =
	"w-11 h-11 rounded-xl flex items-center justify-center shrink-0";

export const thClass =
	"sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border";

export const tdClass = "px-4 py-3 border-b border-border";

export const selectClass =
	"px-2.5 py-1.5 border border-border rounded-md text-sm bg-card";

export const inputClass =
	"w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-card text-foreground focus-ring";

export const inputClassMd =
	"w-full px-3 py-2 border border-border rounded-md text-sm bg-card focus-ring";

export const DIFFICULTY_LABELS: Record<number, string> = {
	1: "初级",
	2: "中级",
	3: "高级",
};

export const DIFFICULTY_COLORS: Record<string, string> = {
	1: "success",
	2: "warning",
	3: "danger",
};
