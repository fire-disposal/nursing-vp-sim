import { Group, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { exportRecords, getRecords } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { TeachingDashboard } from "@/pages/admin/dashboard/TeachingDashboard";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import type { RecordExtended } from "@/types/record";

export default function Admin() {
	const toast = useToast();

	const { data: recordsData, isLoading: recordsLoading } = useQuery({
		queryKey: queryKeys.training.recentAdmin(),
		queryFn: () => getRecords({ limit: 20, offset: 0 }).then((r) => r.data),
		staleTime: 2 * 60_000,
	});

	const _records = (recordsData?.items ?? []) as RecordExtended[];

	const handleExport = async () => {
		try {
			const { data } = await exportRecords();
			const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = `training_records_${new Date().toISOString().slice(0, 10)}.csv`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("导出成功");
		} catch {
			toast.error("导出失败");
		}
	};

	if (recordsLoading) {
		return (
			<Stack gap="xl">
				<LoadingSkeleton variant="stats" />
				<LoadingSkeleton variant="card" />
			</Stack>
		);
	}

	return (
		<>
			<TeachingDashboard />

			<Group justify="flex-end" mt="md">
				<Button variant="link" size="xs" color="gray" onClick={handleExport}>
					导出训练记录 CSV
				</Button>
			</Group>
		</>
	);
}
