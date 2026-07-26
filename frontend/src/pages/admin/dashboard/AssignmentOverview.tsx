import { useNavigate } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import Button from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

type AssignmentListItem = components["schemas"]["AssignmentListItem"];

interface AssignmentOverviewProps {
	assignments: AssignmentListItem[];
}

export function AssignmentOverview({ assignments }: AssignmentOverviewProps) {
	const navigate = useNavigate();
	const active = assignments.filter((a) => {
		if (a.is_closed) return false;
		if (a.end_time && new Date(a.end_time) < new Date()) return false;
		return true;
	});

	if (active.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>进行中的作业</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{active.slice(0, 5).map((a) => {
					const pct =
						a.student_count > 0
							? Math.round(
									(a.completed_count / a.student_count) * 100,
								)
							: 0;
					return (
						<div
							key={a.id}
							className="flex flex-col gap-2 rounded-lg border p-3"
						>
							<div className="flex items-center justify-between">
								<div className="min-w-0">
									<div className="text-sm font-medium truncate">
										{a.title}
									</div>
									{a.class_name && (
										<div className="text-xs text-muted-foreground">
											{a.class_name}
											{a.end_time && (
												<span>
													{" "}
													·{" "}
													{new Date(
														a.end_time,
													).toLocaleDateString("zh-CN", {
														month: "numeric",
														day: "numeric",
													})}{" "}
													到期
												</span>
											)}
										</div>
									)}
								</div>
								<Button
									variant="outline"
									size="xs"
									onClick={() =>
										navigate(`/admin/assignments/${a.id}`)
									}
								>
									查看详情
								</Button>
							</div>
							<div className="flex items-center gap-2">
								<div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
									<div
										className="h-full rounded-full bg-primary transition-all"
										style={{ width: `${pct}%` }}
									/>
								</div>
								<span className="text-xs text-muted-foreground tabular-nums shrink-0">
									{a.completed_count}/{a.student_count}
								</span>
							</div>
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}
