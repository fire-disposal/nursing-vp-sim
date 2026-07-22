import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { exportRecords, getRecords, getStats } from "@/api";
import { queryKeys } from "@/api/query-keys";
import AdminDashboard from "@/components/dashboard/AdminDashboard";
import { TeachingDashboard } from "@/components/dashboard/TeachingDashboard";
import { useToast } from "@/components/Toast";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import type { RecordExtended } from "@/types/record";

export default function Admin() {
	const navigate = useNavigate();
	const toast = useToast();

	const { data: recordsData, isLoading: recordsLoading } = useQuery({
		queryKey: queryKeys.training.recentAdmin(),
		queryFn: () => getRecords({ limit: 20, offset: 0 }).then((r) => r.data),
		staleTime: 2 * 60_000,
	});

	const records = (recordsData?.items ?? []) as RecordExtended[];

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
			<div className="space-y-6">
				<LoadingSkeleton variant="stats" />
				<LoadingSkeleton variant="card" />
			</div>
		);
	}

	return (
		<>
			<TeachingDashboard />

			<div className="mt-4 flex justify-end">
				<button
					type="button"
					onClick={handleExport}
					className="text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					导出训练记录 CSV
				</button>
			</div>
		</>
	);
}

export function AdminLegacy() {
	const navigate = useNavigate();
	const toast = useToast();

	const { data: statsData, isLoading: statsLoading } = useQuery({
		queryKey: queryKeys.stats.admin(),
		queryFn: () => getStats().then((r) => r.data),
		staleTime: 2 * 60_000,
	});
	const { data: recordsData, isLoading: recordsLoading } = useQuery({
		queryKey: queryKeys.training.recentAdmin(),
		queryFn: () => getRecords({ limit: 20, offset: 0 }).then((r) => r.data),
		staleTime: 2 * 60_000,
	});

	const stats = statsData ?? null;
	const records = (recordsData?.items ?? []) as RecordExtended[];

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

	if (statsLoading || recordsLoading) {
		return (
			<div className="space-y-6">
				<LoadingSkeleton variant="stats" />
				<LoadingSkeleton variant="card" />
			</div>
		);
	}

	return (
		<>
			<AdminDashboard
				stats={stats}
				records={records}
				navigate={navigate}
			/>
			<div className="mt-4 flex justify-end">
				<button
					type="button"
					onClick={handleExport}
					className="text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					导出训练记录 CSV
				</button>
			</div>
		</>
	);
}
