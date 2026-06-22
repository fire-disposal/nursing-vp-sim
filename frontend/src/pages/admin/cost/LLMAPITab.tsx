import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, Cpu, TrendingUp } from "lucide-react";
import { fetchSecrets } from "@/api/admin/api-management";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import StatCard from "@/components/ui/StatCard";
import ApiManagementTab from "@/components/teacher/ApiManagementTab";

function LLMCostSummary() {
	const { data: secrets = [], isLoading } = useQuery({
		queryKey: ["admin", "api", "secrets"],
		queryFn: () => fetchSecrets().then((r) => r.data),
		staleTime: 60_000,
	});

	if (isLoading) return <LoadingSkeleton />;

	const totalCostToday = secrets.reduce(
		(sum, s) => sum + (s.total_cost_today || 0),
		0,
	);
	const totalCostMonth = secrets.reduce(
		(sum, s) => sum + (s.monthly_cost_used || 0),
		0,
	);
	const totalCallsToday = secrets.reduce(
		(sum, s) => sum + (s.call_count_today || 0),
		0,
	);
	const totalMonthlyLimit = secrets.reduce(
		(sum, s) => sum + (s.monthly_cost_limit || 0),
		0,
	);
	const budgetPct =
		totalMonthlyLimit > 0
			? ((totalCostMonth / totalMonthlyLimit) * 100).toFixed(1)
			: "0";

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			<StatCard
				icon={CircleDollarSign}
				value={`¥${totalCostToday.toFixed(4)}`}
				label="今日 LLM 费用"
				color="blue"
			/>
			<StatCard
				icon={TrendingUp}
				value={`¥${totalCostMonth.toFixed(4)}`}
				label="本月 LLM 费用"
				color="teal"
			/>
			<StatCard
				icon={Cpu}
				value={totalCallsToday}
				label="今日调用次数"
				color="amber"
			/>
			<StatCard
				icon={CircleDollarSign}
				value={`${budgetPct}%`}
				label={`月度预算 (¥${totalMonthlyLimit.toFixed(0)})`}
				color={Number(budgetPct) > 90 ? "red" : "green"}
			/>
		</div>
	);
}

export default function LLMAPITab() {
	return (
		<div className="space-y-6 mt-4">
			<Card>
				<CardHeader>
					<CardTitle>LLM 费用概览</CardTitle>
				</CardHeader>
				<CardContent>
					<LLMCostSummary />
				</CardContent>
			</Card>

			<ApiManagementTab />
		</div>
	);
}
