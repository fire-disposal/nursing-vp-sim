import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import BreadcrumbBar from "./BreadcrumbBar";
import ShellTransition from "./ShellTransition";

/**
 * ReviewShell — 分析反思壳
 */
export default function ReviewShell({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col h-full">
			<header
				className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3"
				style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
			>
				<button
					onClick={() => window.history.back()}
					className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
					aria-label="返回"
				>
					<ArrowLeft size={18} />
				</button>
				<BreadcrumbBar />
			</header>
			<div className="flex-1 overflow-y-auto">
				<ShellTransition>{children}</ShellTransition>
			</div>
		</div>
	);
}
