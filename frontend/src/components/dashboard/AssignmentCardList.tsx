import { ClipboardList, Play } from "lucide-react";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import {
	Card,
	CardContent,
} from "@/components/ui/card";
import { cn } from "@/utils/cn";

export default function AssignmentCardList({
	studentAssignments,
	onStart,
}: {
	studentAssignments: components["schemas"]["StudentAssignmentItem"][];
	onStart: (id: string) => void;
}) {
	if (studentAssignments.length === 0) return null;

	return (
		<div className="mb-6 space-y-3">
			<div className="flex items-center gap-2">
				<ClipboardList size={18} className="text-primary" />
				<h2 className="text-lg font-semibold">待完成练习</h2>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{studentAssignments.map((a) => {
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
										onClick={() => onStart(a.id)}
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
	);
}
