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
			className={`flex w-full items-center justify-center rounded-2xl border border-border bg-muted ${className ?? ""}`}
		>
			<span className="select-none text-center text-sm font-medium text-black">
				系统截图 · {label ?? `${width}×${height}`}
			</span>
		</div>
	);
}
