import { useQuery } from "@tanstack/react-query";
import { Play, Stethoscope } from "lucide-react";
import type { components } from "@/api/api-types.gen";
import { getStudentAssignments, startAssignment } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
import type { RecordExtended } from "@/types/record";
import AssignmentCardList from "./AssignmentCardList";
import RecentTrainingTable from "./RecentTrainingTable";

type CaseBrief = components["schemas"]["CaseBrief"];
type DurationStats = components["schemas"]["DurationStats"];

const SCORE_COLORS = (s: number) =>
	s >= 85 ? "text-success-foreground" : s >= 70 ? "text-info-foreground" : s >= 60 ? "text-neutral-foreground" : "text-danger-foreground";

const SCORE_LABEL = (s: number) =>
	s >= 85 ? "优秀" : s >= 70 ? "良好" : s >= 60 ? "一般" : "待提高";

export default function StudentDashboard({
	cases: _cases,
	records,
	durationStats,
	navigate,
	inProgressRecord: inProgressRecordProp,
}: {
	cases: CaseBrief[];
	records: RecordExtended[];
	durationStats: DurationStats | null;
	navigate: (path: string, opts?: { state?: Record<string, unknown> }) => void;
	inProgressRecord?: RecordExtended | null;
}) {
	const toast = useToast();
	const user = useAuthStore((s) => s.user);

	const inProgressRecord =
		inProgressRecordProp ?? records.find((r) => r.status === "in_progress");
	const completedCount = records.filter((r) => r.status === "completed").length;
	const latestCompleted = records.find(
		(r) => r.status === "completed" && r.score_total != null,
	);
	const latestScore = latestCompleted?.score_total;

	const { data: studentAssignmentsData } = useQuery({
		queryKey: queryKeys.assignments.student,
		queryFn: () => getStudentAssignments().then((r) => r.data),
		staleTime: 2 * 60_000,
	});
	const studentAssignments = studentAssignmentsData ?? [];

	const handleStartAssignment = async (assignmentId: string) => {
		try {
			const res = await startAssignment(assignmentId);
			navigate(`/training/${res.data.record_id}`);
		} catch (e: unknown) {
			toast.error(e instanceof Error ? e.message : "开始练习失败");
			throw e;
		}
	};

	const totalMinutes = durationStats?.total_minutes ?? 0;

	return (
		<>
			<PageHeader
				title={`欢迎回来，${user?.display_name || "同学"}`}
				subtitle="选择病例，开始护理病史采集训练"
				actions={
					<Button
						size="lg"
						onClick={() =>
							inProgressRecord
								? navigate(`/training/${inProgressRecord.id}`)
								: navigate("/training")
						}
					>
						{inProgressRecord ? (
							<><Play size={16} /> 继续训练</>
						) : (
							<><Stethoscope size={16} /> 开始训练</>
						)}
					</Button>
				}
			/>

			<div className="flex flex-col gap-4">
				<AssignmentCardList
					studentAssignments={studentAssignments}
					onStart={handleStartAssignment}
					onViewResult={(recordId) => navigate(`/record/${recordId}`)}
				/>

				<div className="grid grid-cols-3 gap-3">
					<div className="rounded-xl border bg-card p-4 text-center">
						<div className="text-2xl font-bold text-foreground">{records.length}</div>
						<div className="text-[11px] text-muted-foreground mt-0.5">训练次数</div>
					</div>
					<div className="rounded-xl border bg-card p-4 text-center">
						<div className="text-2xl font-bold text-foreground">{completedCount}</div>
						<div className="text-[11px] text-muted-foreground mt-0.5">已完成</div>
					</div>
					<div className="rounded-xl border bg-card p-4 text-center">
						{latestScore != null ? (
							<>
								<div className={`text-2xl font-bold ${SCORE_COLORS(latestScore)}`}>{latestScore}</div>
								<div className="text-[11px] text-muted-foreground mt-0.5">
									{SCORE_LABEL(latestScore)} · {totalMinutes}分钟
								</div>
							</>
						) : (
							<>
								<div className="text-2xl font-bold text-muted-foreground">-</div>
								<div className="text-[11px] text-muted-foreground mt-0.5">暂无评分</div>
							</>
						)}
					</div>
				</div>

				<RecentTrainingTable
					records={records.slice(0, 5)}
					navigate={navigate}
				/>
			</div>
		</>
	);
}
