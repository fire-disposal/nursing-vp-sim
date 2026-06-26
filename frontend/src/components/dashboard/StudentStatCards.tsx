import {
	CheckCircle,
	ClipboardList,
	Clock,
	Target,
} from "lucide-react";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/badge";
import StatCard from "@/components/ui/stat-card";

type DurationStats = components["schemas"]["DurationStats"];

interface GradeInfo {
	label: string;
	color: "green" | "blue" | "amber" | "red";
}

export default function StudentStatCards({
	totalRecords,
	completedCount,
	durationStats,
	latestScore,
}: {
	totalRecords: number;
	completedCount: number;
	durationStats: DurationStats | null;
	latestScore: number | null | undefined;
}) {
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

	const scoreColor =
		scoreGrade?.color === "green"
			? "green"
			: scoreGrade?.color === "red"
				? "red"
				: scoreGrade?.color === "amber"
					? "amber"
					: "blue";

	return (
		<div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
			<StatCard
				icon={ClipboardList}
				value={totalRecords}
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
	);
}
