import LoadingSkeleton from "./loading-skeleton";

/**
 * Spinner-centered loading state.
 * @deprecated Use LoadingSkeleton with variant="spinner" instead.
 */
export default function LoadingState({
	message,
	className,
}: {
	message?: string;
	className?: string;
}) {
	return (
		<LoadingSkeleton variant="spinner" message={message} className={className} />
	);
}
