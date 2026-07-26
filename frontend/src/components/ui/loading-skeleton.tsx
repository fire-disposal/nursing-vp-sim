import { cn } from "@/utils/cn";

type SkeletonVariant = "card" | "stats" | "table" | "text" | "spinner";

const TABLE_ROW_WIDTHS = [
	["w-2/3", "w-3/4", "w-1/2"],
	["w-3/5", "w-1/2", "w-4/5"],
	["w-1/2", "w-2/3", "w-3/5"],
	["w-4/5", "w-3/4", "w-2/3"],
	["w-3/4", "w-1/2", "w-3/5"],
];

interface LoadingSkeletonProps {
	variant?: SkeletonVariant;
	message?: string;
	className?: string;
}

export default function LoadingSkeleton({
	variant = "card",
	message = "加载中...",
	className,
}: LoadingSkeletonProps) {
	if (variant === "card") {
		return <div className="h-40 w-full rounded-xl bg-muted animate-pulse" />;
	}

	if (variant === "stats") {
		return (
			<div className="grid grid-cols-4 gap-4">
				{[0, 1, 2, 3].map((i) => (
					<div
						key={i}
						className="h-24 w-full rounded-xl bg-muted animate-pulse"
					/>
				))}
			</div>
		);
	}

	if (variant === "table") {
		return (
			<div className="flex flex-col gap-3">
				{TABLE_ROW_WIDTHS.map((cols, rowIdx) => (
					<div key={rowIdx} className="flex gap-4">
						{cols.map((w, colIdx) => (
							<div
								key={colIdx}
								className={cn("h-4 rounded bg-muted animate-pulse", w)}
							/>
						))}
					</div>
				))}
			</div>
		);
	}

	if (variant === "text") {
		return <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />;
	}


	if (variant === "spinner") {
		return (
			<div
				className={cn(
					"flex flex-col items-center justify-center py-12 text-center text-muted-foreground",
					className,
				)}
			>
				<div className="mb-3 size-8 animate-spin rounded-full border-[3px] border-muted border-t-primary" />
				<span className="text-sm">{message}</span>
			</div>
		);
	}

}
