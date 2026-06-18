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
import { useToast } from "@/components/Toast";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import PageHeader from "@/components/ui/PageHeader";
import useAuthStore from "@/stores/authStore";
import type { ScoreData } from "@/types/score";
import StudentDashboard from "./StudentDashboard";
import TeacherDashboard from "./TeacherDashboard";

interface RecordExtended {
	id: number;
	case_id: number;
	case_name: string;
	user_display_name?: string;
	start_time: string;
	end_time: string | null;
	status: string;
	score_total?: number | null;
	scoring_status?: string | null;
	scoring_error?: string | null;
	score?: ScoreData | null;
}

export default function DashboardHome() {
	const navigate = useNavigate();
	const toast = useToast();

	const perms = useAuthStore((s) => s.permissions);
	const isAdmin =
		perms.includes("score_review") || perms.includes("user_manage");

	const { data: casesData, isLoading: casesLoading } = useQuery({
		queryKey: ["cases", "student"],
		queryFn: () => getCases().then((r) => r.data),
		enabled: !isAdmin,
		staleTime: 5 * 60_000,
	});
	const { data: durationData, isLoading: durationLoading } = useQuery({
		queryKey: ["durationStats"],
		queryFn: () => getDurationStats().then((r) => r.data),
		enabled: !isAdmin,
		staleTime: 2 * 60_000,
	});
	const { data: statsData, isLoading: statsLoading } = useQuery({
		queryKey: ["adminStats"],
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
