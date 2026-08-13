import { Loader, SimpleGrid, Skeleton, Stack, Text } from "@mantine/core";
import { cn } from "@/lib/utils";

type SkeletonVariant = "card" | "stats" | "table" | "text" | "spinner";

const TABLE_ROW_WIDTHS = [
	["66%", "75%", "50%"],
	["60%", "50%", "80%"],
	["50%", "66%", "60%"],
	["80%", "75%", "66%"],
	["75%", "50%", "60%"],
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
		return <Skeleton height={160} radius="md" className={className} />;
	}

	if (variant === "stats") {
		return (
			<SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} height={96} radius="md" />
				))}
			</SimpleGrid>
		);
	}

	if (variant === "table") {
		return (
			<Stack gap="md">
				{TABLE_ROW_WIDTHS.map((cols, rowIdx) => (
					<div key={rowIdx} style={{ display: "flex", gap: "1rem" }}>
						{cols.map((w, colIdx) => (
							<Skeleton key={colIdx} height={16} width={w} />
						))}
					</div>
				))}
			</Stack>
		);
	}

	if (variant === "text") {
		return <Skeleton height={16} width="75%" className={className} />;
	}

	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center py-12 text-center",
				className,
			)}
		>
			<Loader size="sm" mb="md" />
			<Text size="sm" c="dimmed">
				{message}
			</Text>
		</div>
	);
}
