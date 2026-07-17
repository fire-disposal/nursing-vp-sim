import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router-dom";
import {
	getCases,
	getDurationStats,
	getRecords,
} from "@/api";
import { queryKeys } from "@/api/query-keys";
import StudentDashboard from "@/components/dashboard/StudentDashboard";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
import type { RecordExtended } from "@/types/record";
import { isAdminPermissions } from "@/utils/permissions";

export default function DashboardHome() {
	const navigate = useNavigate();
	const perms = useAuthStore((s) => s.permissions);
	const isAdmin = isAdminPermissions(perms);

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
	const { data: recordsData, isLoading: recordsLoading } = useQuery({
		queryKey: queryKeys.training.recentStudent(),
		queryFn: () => getRecords({ limit: 20, offset: 0 }).then((r) => r.data),
		staleTime: 2 * 60_000,
	});
	const { data: inProgressData } = useQuery({
		queryKey: queryKeys.training.records({ status: "in_progress" }),
		queryFn: () =>
			getRecords({ status: "in_progress", limit: 1, offset: 0 }).then((r) => r.data),
		staleTime: 60_000,
		enabled: !isAdmin,
	});

	if (isAdmin) {
		return <Navigate to="/admin" replace />;
	}

	const cases = casesData?.items ?? [];
	const records = (recordsData?.items ?? []) as RecordExtended[];
	const inProgressRecord =
		((inProgressData?.items ?? []) as RecordExtended[])[0] ?? null;
	const durationStats = durationData ?? null;

	if (casesLoading || recordsLoading || durationLoading) {
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

	return (
		<StudentDashboard
			cases={cases}
			records={records}
			durationStats={durationStats}
			navigate={navigate}
			inProgressRecord={inProgressRecord}
		/>
	);
}
