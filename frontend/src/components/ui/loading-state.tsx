import { cn } from "@/utils/cn";

export default function LoadingState({
	message = "加载中...",
	className,
}: {
	message?: string;
	className?: string;
}) {
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
