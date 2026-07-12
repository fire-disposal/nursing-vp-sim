import { useQuery } from "@tanstack/react-query";
import { BookOpen, Play, Stethoscope } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import { getStudentAssignments, startAssignment } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { useFeedback } from "@/components/FeedbackProvider";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import {
	Card,
	CardContent,
} from "@/components/ui/card";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
import type { RecordExtended } from "@/types/record";
import AssignmentCardList from "./AssignmentCardList";
import RecentTrainingTable from "./RecentTrainingTable";
import RecommendedCaseList from "./RecommendedCaseList";
import StudentSidebar from "./StudentSidebar";
import StudentStatCards from "./StudentStatCards";

type CaseBrief = components["schemas"]["CaseBrief"];
type DurationStats = components["schemas"]["DurationStats"];

export default function StudentDashboard({
	cases,
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
	const location = useLocation();
	const { openFeedback, showPrompt } = useFeedback();
	const toast = useToast();
	const user = useAuthStore((s) => s.user);

	useEffect(() => {
		const state = location.state as { feedbackPrompt?: number } | null;
		if (state?.feedbackPrompt && showPrompt) {
			openFeedback();
			window.history.replaceState({}, document.title);
		}
	}, [location.state, showPrompt, openFeedback]);

	// 优先用显式 status=in_progress 查询结果（可靠识别任意未完成练习，不受"最近N条"限制）；
	// 未传入时回退到从 records 里查找。
	const inProgressRecord =
		inProgressRecordProp ?? records.find((r) => r.status === "in_progress");
	const latestCompleted = records.find(
		(r) => r.status === "completed" && r.score_total != null,
	);
	const completedCount = records.filter((r) => r.status === "completed").length;
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
		}
	};

	const recentCases = cases.slice(0, 3);

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
							<>
								<Play size={16} />
								继续训练
							</>
						) : (
							<>
								<Stethoscope size={16} />
								开始训练
							</>
						)}
					</Button>
				}
			/>

			<AssignmentCardList
				studentAssignments={studentAssignments}
				onStart={handleStartAssignment}
				onViewResult={(recordId) => navigate(`/record/${recordId}`)}
			/>

			<StudentStatCards
				totalRecords={records.length}
				completedCount={completedCount}
				durationStats={durationStats}
				latestScore={latestScore}
			/>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] items-start">
				<div className="flex flex-col gap-6 min-w-0">
					<Card size="sm">
						<CardContent className="flex flex-col items-center p-8 sm:p-12">
							<div className="flex size-[56px] sm:size-[88px] items-center justify-center rounded-full bg-accent text-accent-foreground mb-3 sm:mb-6">
								<Stethoscope size={40} />
							</div>
							<div className="text-xl font-bold text-foreground mb-1.5">
								{inProgressRecord ? "继续进行中的训练" : "开始新的病史采集训练"}
							</div>
							<div className="text-sm text-muted-foreground max-w-[360px] text-center mb-4 hidden sm:block">
								{inProgressRecord
									? "你有一个进行中的训练，点击下方按钮继续。"
									: "选择虚拟患者，系统模拟真实护理问诊场景，训练结束后自动评分并提供反馈。"}
							</div>
							<div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-accent text-accent-foreground rounded-full text-xs font-medium mb-3 sm:mb-6">
								<BookOpen size={14} /> 病例库：{cases.length} 例可用
							</div>
							<Button
								size="lg"
								className="px-[52px]"
								onClick={() =>
									inProgressRecord
										? navigate(`/training/${inProgressRecord.id}`)
										: navigate("/training")
								}
							>
								{inProgressRecord ? "继续训练" : "开始新的病史采集训练"}
							</Button>
							{!inProgressRecord && (
								<div className="text-xs text-muted-foreground mt-2.5">
									约 20 分钟完成一次训练
								</div>
							)}
						</CardContent>
					</Card>

					<RecommendedCaseList recentCases={recentCases} navigate={navigate} />

					<RecentTrainingTable
						records={records.slice(0, 5)}
						navigate={navigate}
					/>
				</div>

				<StudentSidebar
					latestCompleted={latestCompleted}
					durationStats={durationStats}
					navigate={navigate}
				/>
			</div>
		</>
	);
}
