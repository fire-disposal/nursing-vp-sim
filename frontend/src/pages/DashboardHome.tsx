import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
	exportRecords,
	getCases,
	getDurationStats,
	getRecords,
	getStats,
} from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import StudentDashboard from "@/components/dashboard/StudentDashboard";
import TeacherDashboard from "@/components/dashboard/TeacherDashboard";
import { useToast } from "@/components/Toast";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
import type { RecordExtended } from "@/types/record";

export default function DashboardHome() {
	const navigate = useNavigate();
	const toast = useToast();

	const perms = useAuthStore((s) => s.permissions);
	const isAdmin = perms.some(
		(p) => p !== "training_access" && p !== "qa_access",
	);

	const { data: casesData, isLoading: casesLoading } = useQuery({
		queryKey: queryKeys.cases.student(),
		queryFn: () => getCases().then((r) => r.data),
		enabled: !isAdmin,
		staleTime: 5 * 60_000,
	});
	const { data: durationData, isLoading: durationLoading } = useQuery({
		queryKey: queryKeys.stats.duration(),
		queryFn: () => getDurationStats().then((r) => r.data),
		enabled: !isAdmin,
		staleTime: 2 * 60_000,
	});
	const { data: statsData, isLoading: statsLoading } = useQuery({
		queryKey: queryKeys.stats.admin(),
		queryFn: () => getStats().then((r) => r.data),
		enabled: isAdmin,
		staleTime: 2 * 60_000,
	});
	const { data: recordsData, isLoading: recordsLoading } = useQuery({
		queryKey: queryKeys.training.recent(),
		queryFn: () => getRecords({ limit: 20, offset: 0 }).then((r) => r.data),
		staleTime: 2 * 60_000,
	});

	const cases = casesData?.items ?? [];
	const records = (recordsData?.items ?? []) as RecordExtended[];
	const durationStats = durationData ?? null;
	const stats = statsData ?? null;

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

	const isLoading =
		recordsLoading ||
		(isAdmin ? statsLoading : casesLoading || durationLoading);

	if (isLoading) {
		return (
			<>
				<PageHeader title="加载中..." subtitle="正在获取最新数据" />
				<div className="space-y-6">
					<LoadingSkeleton variant="stats" />
					<LoadingSkeleton variant="card" />
				</div>
			</>
		);
	}

	if (isAdmin) {
		return (
			<TeacherDashboard
				stats={stats}
				records={records}
				handleExport={handleExport}
				navigate={navigate}
			/>
		);
	}

	return (
		<StudentDashboard
			cases={cases}
			records={records}
			durationStats={durationStats}
			navigate={navigate}
		/>
	);
}
