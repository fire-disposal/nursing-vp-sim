import { Group, Pagination as MantinePagination, Text } from "@mantine/core";
import { cn } from "@/lib/utils";

interface PaginationProps {
	total: number;
	offset: number;
	limit: number;
	onChange: (newOffset: number) => void;
	className?: string;
}

export default function Pagination({
	total,
	offset,
	limit,
	onChange,
	className,
}: PaginationProps) {
	const lastPageOffset = total > 0 ? Math.floor((total - 1) / limit) * limit : 0;
	const pageOffset = Math.min(Math.max(0, offset), lastPageOffset);
	const currentStart = total === 0 ? 0 : pageOffset + 1;
	const currentEnd = Math.min(pageOffset + limit, total);
	const page = Math.floor(pageOffset / limit) + 1;
	const totalPages = Math.max(1, Math.ceil(total / limit));

	return (
		<Group justify="space-between" gap="md" wrap="wrap" className={cn(className)}>
			<Text size="sm" c="dimmed">
				第 {currentStart}-{currentEnd} 条，共 {total} 条
			</Text>
			<MantinePagination
				total={totalPages}
				value={page}
				onChange={(p) => onChange((p - 1) * limit)}
				size="sm"
			/>
		</Group>
	);
}
