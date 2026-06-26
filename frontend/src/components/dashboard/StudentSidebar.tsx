import {
	ArrowRight,
	Award,
	MessageCircle,
	Target,
	TrendingUp,
} from "lucide-react";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { ScoreData } from "@/types/score";

type DurationStats = components["schemas"]["DurationStats"];

const QUICK_QA_HINTS = [
	"如何询问患者既往病史？",
	"糖尿病患者病史采集重点是什么？",
	"如何评估疼痛程度？",
];

interface RecordBrief {
	id: number;
	case_name: string;
	start_time: string;
	score_total?: number | null;
	score?: ScoreData | null;
}

export default function StudentSidebar({
	latestCompleted,
	durationStats,
	navigate,
}: {
	latestCompleted: RecordBrief | undefined;
	durationStats: DurationStats | null;
	navigate: (path: string, opts?: { state?: Record<string, unknown> }) => void;
}) {
	return (
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
									{latestCompleted.score
										?.detail_scores?.沟通技能?.score ?? "-"}
										<span className="text-xs text-muted-foreground">
											/
											{latestCompleted.score
												?.detail_scores?.沟通技能?.max ?? "?"}
										</span>
									</span>
								</div>
								<div className="py-1.5 px-2.5 bg-muted rounded-md text-center">
									<span className="text-xs text-muted-foreground">
										病史采集
									</span>
									<span className="block text-sm font-bold text-teal-600">
										{latestCompleted.score
											?.detail_scores?.病史采集?.score ?? "-"}
										<span className="text-xs text-muted-foreground">
											/
											{latestCompleted.score
												?.detail_scores?.病史采集?.max ?? "?"}
										</span>
									</span>
								</div>
							</div>
							<div className="mt-1">
								{latestCompleted.score?.strengths
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
	);
}
