import { CheckCircle2, ClipboardList, Clock, Loader2, Play } from "lucide-react";
import { useState } from "react";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { cn } from "@/utils/cn";

type Assignment = components["schemas"]["StudentAssignmentItem"];

function dueLabel(endTime: string): { text: string; urgent: boolean } {
	const diffMs = new Date(endTime).getTime() - Date.now();
	const hoursLeft = Math.ceil(diffMs / (1000 * 60 * 60));
	const minsLeft = Math.ceil(diffMs / (1000 * 60));
	if (minsLeft <= 0) return { text: "即将截止", urgent: true };
	if (minsLeft < 60) return { text: `剩 ${minsLeft} 分钟`, urgent: true };
	if (hoursLeft <= 24) return { text: `剩 ${hoursLeft} 小时`, urgent: true };
	return { text: `剩 ${Math.ceil(hoursLeft / 24)} 天`, urgent: false };
}

export default function AssignmentCardList({
	studentAssignments,
	onStart,
	onViewResult,
}: {
	studentAssignments: Assignment[];
	onStart: (id: string) => Promise<void>;
	onViewResult?: (recordId: number) => void;
}) {
	const [startingId, setStartingId] = useState<string | null>(null);

	if (studentAssignments.length === 0) return null;

	const pending = studentAssignments.filter(
		(a) => a.status !== "completed" && a.status !== "closed",
	).length;

	return (
		<section className="mb-6 overflow-hidden rounded-xl bg-primary/5 ring-1 ring-primary/20">
			<div className="flex items-center justify-between gap-3 border-b border-primary/10 bg-primary/10 px-4 py-3">
				<div className="flex items-center gap-2.5">
					<div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<ClipboardList size={18} />
					</div>
					<div>
						<h2 className="text-base font-semibold leading-tight text-foreground">
							教师布置的作业
						</h2>
						<p className="text-xs text-muted-foreground">
							{pending > 0
								? `${pending} 项待完成，请在截止前提交`
								: "全部已完成，做得好！"}
						</p>
					</div>
				</div>
				{pending > 0 && (
					<Badge variant="default" className="shrink-0">
						{pending} 待完成
					</Badge>
				)}
			</div>

			<div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
				{studentAssignments.map((a) => {
					const isClosed = a.status === "closed";
					const isOverdue = a.status === "overdue";
					const isCompleted = a.status === "completed";
					const due = dueLabel(a.end_time);
					return (
						<div
							key={a.id}
							className={cn(
								"flex flex-col gap-2 rounded-lg border bg-card p-4 transition-shadow hover:shadow-sm",
								isClosed
									? "border-muted bg-muted/30"
									: isOverdue
										? "border-destructive/40"
										: isCompleted
											? "border-border opacity-90"
											: "border-primary/30",
							)}
						>
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<div className="truncate text-sm font-semibold">
										{a.title}
									</div>
									<div className="truncate text-xs text-muted-foreground">
										{a.case_name}
									</div>
								</div>
								{isClosed ? (
									<Badge variant="outline" className="shrink-0">
										已关闭
									</Badge>
								) : isCompleted ? (
									<Badge variant="success" className="shrink-0">
										<CheckCircle2 size={12} /> 已完成
									</Badge>
								) : isOverdue ? (
									<Badge variant="destructive" className="shrink-0">
										已逾期
									</Badge>
								) : (
									<Badge
										variant={due.urgent ? "warning" : "outline"}
										className="shrink-0"
									>
										<Clock size={12} /> {due.text}
									</Badge>
								)}
							</div>

							{isClosed ? null : isCompleted ? (
								<div className="mt-auto flex items-end justify-between">
									{a.score_total != null ? (
										<>
											<div>
												<span className="text-2xl font-bold text-primary">
													{a.score_total}
												</span>
												<span className="ml-0.5 text-xs text-muted-foreground">
													分
												</span>
											</div>
											{onViewResult && a.record_id != null && (
												<Button
													size="xs"
													variant="outline"
													onClick={() => onViewResult(a.record_id as number)}
												>
													查看结果
												</Button>
											)}
										</>
									) : (
										<div className="flex items-center gap-2">
											<Loader2 size={14} className="animate-spin text-muted-foreground" />
											<span className="text-xs text-muted-foreground">评分中...</span>
										</div>
									)}
								</div>
							) : isClosed ? (
								<div className="mt-auto text-center text-xs text-muted-foreground py-1">
									作业已关闭
								</div>
							) : (
								<Button
									size="sm"
									variant={isOverdue ? "outline" : "default"}
									className="mt-auto w-full"
									disabled={startingId === a.id}
									onClick={async () => {
										setStartingId(a.id);
										try {
											await onStart(a.id);
										} catch {
											setStartingId(null);
										}
									}}
								>
									{startingId === a.id ? (
										<Loader2 size={14} className="animate-spin mr-1.5" />
									) : (
										<Play size={14} />
									)}
									{startingId === a.id ? "启动中…" : isOverdue ? "补做练习" : "开始练习"}
								</Button>
							)}
						</div>
					);
				})}
			</div>
		</section>
	);
}
