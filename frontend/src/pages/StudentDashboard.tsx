import { useQuery } from "@tanstack/react-query";
import {
	ArrowRight,
	Award,
	BookOpen,
	CheckCircle,
	ClipboardList,
	Clock,
	MessageCircle,
	Play,
	Star,
	Stethoscope,
	Target,
	TrendingUp,
} from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import { getStudentAssignments, startAssignment } from "@/api/assignments";
import { useFeedback } from "@/components/FeedbackProvider";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/authStore";
import type { ScoreData } from "@/types/score";

type CaseBrief = components["schemas"]["CaseBrief"];
type DurationStats = components["schemas"]["DurationStats"];

const QUICK_QA_HINTS = [
	"如何询问患者既往病史？",
	"糖尿病患者病史采集重点是什么？",
	"如何评估疼痛程度？",
];

interface PatientSummary {
	gender?: string;
	age?: number;
	chief_complaint?: string;
}

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

interface GradeInfo {
	label: string;
	color: "green" | "blue" | "amber" | "red";
}

export default function StudentDashboard({
	cases,
	records,
	durationStats,
	navigate,
}: {
	cases: CaseBrief[];
	records: RecordExtended[];
	durationStats: DurationStats | null;
	navigate: (path: string, opts?: { state?: Record<string, unknown> }) => void;
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

	const inProgressRecord = records.find((r) => r.status === "in_progress");
	const latestCompleted = records.find(
		(r) => r.status === "completed" && r.score_total != null,
	);
	const completedCount = records.filter((r) => r.status === "completed").length;
	const latestScore = latestCompleted?.score_total;

	const { data: studentAssignmentsData } = useQuery({
		queryKey: ["student-assignments"],
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

	const scoreGrade: GradeInfo | null =
		latestScore != null
			? latestScore >= 85
				? { label: "优秀", color: "green" }
				: latestScore >= 70
					? { label: "良好", color: "blue" }
					: latestScore >= 60
						? { label: "一般", color: "amber" }
						: { label: "待提高", color: "red" }
			: null;

	const recentCases = cases.slice(0, 3);

	const getPatientSummary = (ps: unknown): PatientSummary => {
		if (ps && typeof ps === "object") return ps as PatientSummary;
		return {};
	};

	const scoreColor =
		scoreGrade?.color === "green"
			? "green"
			: scoreGrade?.color === "red"
				? "red"
				: scoreGrade?.color === "amber"
					? "amber"
					: "blue";

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
								: navigate("/cases")
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

			<div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
				<StatCard
					icon={ClipboardList}
					value={records.length}
					label="训练总次数"
					color="blue"
				/>
				<StatCard
					icon={CheckCircle}
					value={completedCount}
					label="已完成"
					color="green"
				/>
				<StatCard
					icon={Clock}
					value={durationStats?.total_minutes ?? 0}
					label="累计分钟"
					color="amber"
				/>
				<StatCard
					icon={Target}
					value={
						<>
							{latestScore != null ? `${latestScore}分` : "-"}
							{scoreGrade && (
								<Badge
									variant={
										scoreGrade.color === "green"
											? "success"
											: scoreGrade.color === "red"
												? "danger"
												: scoreGrade.color === "amber"
													? "warning"
													: "info"
									}
									className="ml-1.5 text-[0.625rem]"
								>
									{scoreGrade.label}
								</Badge>
							)}
						</>
					}
					label="最新得分"
					color={scoreColor}
				/>
			</div>

			{studentAssignments.length > 0 && (
				<div className="mb-6 space-y-3">
					<div className="flex items-center gap-2">
						<ClipboardList size={18} className="text-primary" />
						<h2 className="text-lg font-semibold">待完成练习</h2>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{studentAssignments.map((a: components["schemas"]["StudentAssignmentItem"]) => {
							const isOverdue = a.status === "overdue";
							const isCompleted = a.status === "completed";
							const hoursLeft = Math.max(
								0,
								Math.ceil(
									(new Date(a.end_time).getTime() - Date.now()) /
										(1000 * 60 * 60),
								),
							);
							return (
								<Card
									key={a.id}
									size="sm"
									className={cn(
										isOverdue && "border-destructive/30 bg-destructive/5",
									)}
								>
									<CardContent className="p-4">
										<div className="flex items-start justify-between mb-2">
											<div className="min-w-0">
												<div className="text-sm font-semibold truncate">
													{a.title}
												</div>
												<div className="text-xs text-muted-foreground">
													{a.practice_name}
												</div>
											</div>
											{isCompleted ? (
												<Badge variant="outline" className="shrink-0 ml-2">
													已完成
												</Badge>
											) : isOverdue ? (
												<Badge variant="destructive" className="shrink-0 ml-2">
													已逾期
												</Badge>
											) : (
												<Badge variant="default" className="shrink-0 ml-2">
													{hoursLeft > 24
														? `${Math.ceil(hoursLeft / 24)}天`
														: `${hoursLeft}小时`}
												</Badge>
											)}
										</div>
										{a.score_total != null && (
											<div className="text-lg font-bold text-primary mb-2">
												{a.score_total} 分
											</div>
										)}
										{!isCompleted && (
											<Button
												size="sm"
												className="w-full"
												onClick={() => handleStartAssignment(a.id)}
											>
												<Play size={14} className="mr-1" />
												开始练习
											</Button>
										)}
									</CardContent>
								</Card>
							);
						})}
					</div>
				</div>
			)}

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
										: navigate("/cases")
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

					{recentCases.length > 0 && (
						<Card size="sm">
							<CardHeader className="flex-row items-center justify-between border-b pb-4">
								<CardTitle className="flex items-center gap-2">
									<BookOpen size={17} />
									推荐病例
								</CardTitle>
								<CardAction>
									<Button
										variant="link"
										size="sm"
										onClick={() => navigate("/cases")}
									>
										查看全部 →
									</Button>
								</CardAction>
							</CardHeader>
							<CardContent className="pt-4">
								<div className="flex flex-col gap-1">
									{recentCases.map((c) => {
										const p = getPatientSummary(c.patient_summary);
										const d = c.difficulty || 1;
										return (
											<div
												key={c.id}
												className="flex items-center gap-2.5 p-2.5 rounded-lg cursor-pointer transition-colors hover:bg-muted/50"
												onClick={() => navigate("/cases")}
											>
												<div className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
													<Stethoscope size={16} />
												</div>
												<div className="flex-1 min-w-0">
													<div className="text-sm font-semibold text-foreground">
														{c.name}
														<span
														className={cn(
															"inline-flex items-center gap-0.5 ml-2 px-2 py-0.5 rounded-full text-xs font-semibold",
															d === 1 && "bg-success text-success-foreground",
															d === 2 && "bg-warning text-warning-foreground",
															d === 3 && "bg-danger text-danger-foreground",
														)}
													>
														{Array.from({ length: d }).map((_, si) => (
															<Star
																key={`f-${si}`}
																size={12}
																className="text-warning-foreground"
																fill="currentColor"
															/>
														))}
														{Array.from({ length: 3 - d }).map((_, si) => (
															<Star
																key={`e-${si}`}
																size={12}
																className="text-muted-foreground/40"
																fill="none"
															/>
														))}
													</span>
													</div>
													<div className="text-xs text-muted-foreground">
														{p.gender} · {p.age}岁 ·{" "}
														{p.chief_complaint || "查看详情"}
													</div>
												</div>
												<ArrowRight
													size={14}
													className="text-muted-foreground shrink-0"
												/>
											</div>
										);
									})}
								</div>
							</CardContent>
						</Card>
					)}

					{records.length > 0 && (
						<Card size="sm">
							<CardHeader className="flex-row items-center justify-between border-b pb-4">
								<CardTitle className="flex items-center gap-2">
									<ClipboardList size={17} />
									最近训练记录
								</CardTitle>
								<CardAction>
									<Button
										variant="link"
										size="sm"
										onClick={() => navigate("/history")}
									>
										查看全部 →
									</Button>
								</CardAction>
							</CardHeader>
							<div className="max-h-96 overflow-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>病例</TableHead>
											<TableHead>时间</TableHead>
											<TableHead>状态</TableHead>
											<TableHead>得分</TableHead>
											<TableHead />
										</TableRow>
									</TableHeader>
									<TableBody>
										{records.slice(0, 5).map((r) => (
											<TableRow key={r.id}>
												<TableCell>{r.case_name}</TableCell>
												<TableCell className="text-muted-foreground">
													{new Date(r.start_time).toLocaleDateString("zh-CN")}
												</TableCell>
												<TableCell>
													<Badge
														variant={
															r.status === "completed" ? "success" : "info"
														}
													>
														{r.status === "completed" ? "已完成" : "进行中"}
													</Badge>
												</TableCell>
												<TableCell
													className={cn(
														"font-semibold",
														r.score_total != null
															? "text-primary"
															: "text-muted-foreground",
													)}
												>
													{r.score_total != null ? `${r.score_total}分` : "-"}
												</TableCell>
												<TableCell>
													<div className="flex items-center gap-3">
														<Button
															variant="link"
															size="sm"
															onClick={() => navigate(`/record/${r.id}`)}
														>
															详情
														</Button>
														{r.status === "in_progress" && (
															<Button
																variant="link"
																size="sm"
																onClick={() => navigate(`/training/${r.id}`)}
															>
																继续训练
															</Button>
														)}
													</div>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</Card>
					)}
				</div>

				<div className="flex flex-col gap-4">
					<Card size="sm">
						<CardHeader className="pb-3">
							<CardTitle className="flex items-center gap-2 text-sm">
								<Award size={14} />
								最新反馈
							</CardTitle>
						</CardHeader>
						<CardContent>
							{latestCompleted ? (
								<>
									<div className="flex justify-between items-center mb-2">
										<span className="text-sm font-semibold text-foreground">
											{latestCompleted.case_name}
										</span>
										<span className="text-xs text-muted-foreground">
											{new Date(latestCompleted.start_time).toLocaleDateString(
												"zh-CN",
											)}
										</span>
									</div>
									<div className="flex items-baseline gap-1.5 mb-3">
										<span className="text-3xl font-extrabold text-primary">
											{latestCompleted.score_total}
										</span>
										<span className="text-xs text-muted-foreground">分</span>
										<Badge
											variant={
												(latestCompleted.score_total ?? 0) >= 70
													? "success"
													: "warning"
											}
											className="ml-1.5"
										>
											{(latestCompleted.score_total ?? 0) >= 85
												? "优秀"
												: (latestCompleted.score_total ?? 0) >= 70
													? "良好"
													: (latestCompleted.score_total ?? 0) >= 60
														? "一般"
														: "待提高"}
										</Badge>
									</div>
									<div className="grid grid-cols-2 gap-1 mb-2">
										<div className="py-1.5 px-2.5 bg-muted rounded-md text-center">
											<span className="text-xs text-muted-foreground">
												沟通技能
											</span>
										<span className="block text-sm font-bold text-primary">
											{(latestCompleted as { score?: ScoreData }).score
												?.detail_scores?.沟通技能?.score ?? "-"}
												<span className="text-xs text-muted-foreground">
													/
													{(latestCompleted as { score?: ScoreData }).score
														?.detail_scores?.沟通技能?.max ?? "?"}
												</span>
											</span>
										</div>
										<div className="py-1.5 px-2.5 bg-muted rounded-md text-center">
											<span className="text-xs text-muted-foreground">
												病史采集
											</span>
											<span className="block text-sm font-bold text-teal-600">
												{(latestCompleted as { score?: ScoreData }).score
													?.detail_scores?.病史采集?.score ?? "-"}
												<span className="text-xs text-muted-foreground">
													/
													{(latestCompleted as { score?: ScoreData }).score
														?.detail_scores?.病史采集?.max ?? "?"}
												</span>
											</span>
										</div>
									</div>
									<div className="mt-1">
										{(latestCompleted as { score?: ScoreData }).score?.strengths
											?.slice(0, 1)
											.map((s: string, i: number) => (
												<div key={i} className="text-xs text-green-500 py-0.5">
													+ {s}
												</div>
											))}
									</div>
									<div className="mt-2.5">
										<Button
											size="sm"
											onClick={() => navigate(`/record/${latestCompleted.id}`)}
										>
											查看完整报告
										</Button>
									</div>
								</>
							) : (
								<div className="flex items-start gap-2.5 p-3.5 border border-dashed border-border rounded-lg bg-muted/50 text-muted-foreground">
									<Target size={18} className="text-primary shrink-0 mt-0.5" />
									<div>
										<strong className="block text-sm text-foreground mb-0.5">
											还没有训练记录
										</strong>
										<span className="block text-xs leading-relaxed">
											完成第一次病史采集训练后，这里将显示你的评分结果和改进建议。
										</span>
										<Button
											variant="outline"
											size="sm"
											className="mt-2.5"
											onClick={() => navigate("/cases")}
										>
											去训练 →
										</Button>
									</div>
								</div>
							)}
						</CardContent>
					</Card>

					<Card size="sm">
						<CardHeader className="pb-3">
							<CardTitle className="flex items-center gap-2 text-sm">
								<MessageCircle size={14} />
								快速提问
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex gap-1.5 mb-2 qa-quick-row">
								<input
									className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 focus:bg-background placeholder:text-muted-foreground/50"
									placeholder="输入护理专业问题..."
									onKeyDown={(e) => {
										if (
											e.key === "Enter" &&
											(e.target as HTMLInputElement).value.trim()
										) {
											navigate(
												`/qa?q=${encodeURIComponent((e.target as HTMLInputElement).value.trim())}`,
											);
										}
									}}
								/>
								<Button
									size="icon"
									onClick={() => {
										const el = document.querySelector(
											".qa-quick-row input",
										) as HTMLInputElement;
										if (el?.value.trim())
											navigate(`/qa?q=${encodeURIComponent(el.value.trim())}`);
									}}
								>
									<ArrowRight size={16} />
								</Button>
							</div>
							<div className="flex flex-wrap gap-2">
								{QUICK_QA_HINTS.map((h, i) => (
									<span
										key={i}
										className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-md cursor-pointer hover:bg-primary/15 transition-colors"
										onClick={() => navigate(`/qa?q=${encodeURIComponent(h)}`)}
									>
										{h}
									</span>
								))}
							</div>
						</CardContent>
					</Card>

					<Card size="sm">
						<CardHeader className="pb-3">
							<CardTitle className="flex items-center gap-2 text-sm">
								<TrendingUp size={14} />
								本周训练
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex gap-3">
								<div className="flex-1 text-center py-2.5 bg-muted rounded-lg">
									<div className="text-xl font-bold text-primary">
										{durationStats?.total_sessions ?? 0}
									</div>
									<div className="text-xs text-muted-foreground">训练次数</div>
								</div>
								<div className="flex-1 text-center py-2.5 bg-muted rounded-lg">
									<div className="text-xl font-bold text-teal-700">
										{durationStats?.total_minutes ?? 0}
									</div>
									<div className="text-xs text-muted-foreground">累计分钟</div>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</>
	);
}
