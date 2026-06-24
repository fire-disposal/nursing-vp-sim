import { useState } from "react";
import { cn } from "@/lib/utils";
import { EXAMPLE_CONVERSATIONS } from "../data";

export default function ConversationSnippets() {
	const [activeId, setActiveId] = useState(EXAMPLE_CONVERSATIONS[0].id);

	const active = EXAMPLE_CONVERSATIONS.find((c) => c.id === activeId) ?? EXAMPLE_CONVERSATIONS[0];

	return (
		<div className="relative flex min-h-[460px] flex-col overflow-hidden rounded-3xl border border-border/60 bg-card p-6">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(13,148,136,0.10),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.06),transparent_42%)]" />

			<div className="relative z-10 flex items-center justify-between gap-4">
				<div>
					<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">对话示例</div>
					<div className="mt-1 text-lg font-bold text-foreground">虚拟患者交流风格</div>
				</div>
				<div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
					{active.emotionLabel}
				</div>
			</div>

			<div className="relative z-10 mt-5 flex gap-2">
				{EXAMPLE_CONVERSATIONS.map((conv) => (
					<button
						key={conv.id}
						type="button"
						onClick={() => setActiveId(conv.id)}
						className={cn(
							"rounded-full border px-3 py-1 text-xs font-medium transition-all",
							activeId === conv.id
								? "border-primary/40 bg-primary/10 text-primary"
								: "border-border/60 bg-background/70 text-muted-foreground hover:border-primary/20 hover:text-foreground",
						)}
					>
						{conv.title}
					</button>
				))}
			</div>

			<div className="relative z-10 mt-5 min-h-[340px] space-y-4">
				{active.lines.map((line, index) => (
					<div
						key={`${active.id}-${index}`}
						className={cn(
							"flex gap-3",
							line.speaker === "patient" ? "justify-start" : "justify-end",
						)}
					>
						{line.speaker === "patient" && (
							<div className={cn(
								"mt-1 size-8 shrink-0 rounded-full border border-border/60 bg-background flex items-center justify-center text-xs font-bold",
								active.id === "defensive" && "border-rose-500/30 text-rose-500",
								active.id === "trusting" && "border-sky-500/30 text-sky-500",
								active.id === "normal" && "border-emerald-500/30 text-emerald-500",
							)}>
							患
							</div>
						)}
						<div
							className={cn(
								"max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
								line.speaker === "patient"
									? "rounded-tl-md border border-border/60 bg-background/80 text-foreground/90"
									: "rounded-tr-md bg-primary text-primary-foreground",
							)}
						>
							{line.text}
							{line.emotion && (
								<div className="mt-1 text-[10px] font-medium opacity-60">{line.emotion}</div>
							)}
						</div>
						{line.speaker === "nurse" && (
							<div className="mt-1 size-8 shrink-0 rounded-full border border-border/60 bg-background flex items-center justify-center text-xs font-bold text-foreground/60">
								护
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
