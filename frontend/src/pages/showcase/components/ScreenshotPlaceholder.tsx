interface ScreenshotPlaceholderProps {
	width: number;
	height: number;
	label?: string;
	className?: string;
}

/* TODO: 替换为真实系统截图（用户授权的临时占位符） */
export default function ScreenshotPlaceholder({
	width,
	height,
	label,
	className,
}: ScreenshotPlaceholderProps) {
	return (
		<div
			style={{ aspectRatio: `${width} / ${height}` }}
			className={`flex w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border/50 bg-muted/20 ${className ?? ""}`}
		>
			<div className="flex flex-col items-center gap-3 select-none text-center">
				<div className="flex size-11 items-center justify-center rounded-full border border-border/60 bg-background/70">
					<div className="size-5 rounded-sm border-2 border-muted-foreground/30 border-dashed" />
				</div>
				<span className="text-sm font-medium tracking-wide text-muted-foreground/70">
					系统截图 · {label ?? `${width}×${height}`}
				</span>
			</div>
		</div>
	);
}
