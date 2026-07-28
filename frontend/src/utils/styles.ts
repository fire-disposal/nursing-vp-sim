/** Shared CSS class strings for admin pages — single source of truth. */
import { buttonVariants } from "@/components/ui/button";


export const btnPrimary = buttonVariants({ variant: "default", size: "default" });

export const btnSecondary = buttonVariants({ variant: "outline", size: "default" });

export const statCardClass =
	"bg-card rounded-xl shadow-e1 p-5 border border-border flex items-center gap-3.5";

export const statIconClass =
	"w-11 h-11 rounded-xl flex items-center justify-center shrink-0";

export const thClass =
	"sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border";

export const tdClass = "px-4 py-3 border-b border-border";

export const selectClass =
	"flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50";

export const inputClass =
	"flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50";

export const inputClassMd =
	"flex h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50";

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
