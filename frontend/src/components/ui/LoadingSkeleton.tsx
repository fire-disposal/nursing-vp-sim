import { cn } from "@/lib/utils";

type SkeletonVariant = "card" | "stats" | "table" | "text";

const TABLE_ROW_WIDTHS = [
	["w-2/3", "w-3/4", "w-1/2"],
	["w-3/5", "w-1/2", "w-4/5"],
	["w-1/2", "w-2/3", "w-3/5"],
	["w-4/5", "w-3/4", "w-2/3"],
	["w-3/4", "w-1/2", "w-3/5"],
];

export default function LoadingSkeleton({
	variant = "card",
}: {
	variant?: SkeletonVariant;
}) {
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

	return null;
}
