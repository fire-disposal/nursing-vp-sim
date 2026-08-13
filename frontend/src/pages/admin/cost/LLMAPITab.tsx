import { SimpleGrid, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconCoin, IconCpu, IconTrendingUp } from "@tabler/icons-react";
import { fetchSecrets } from "@/api/admin/api-management";
import { queryKeys } from "@/api/query-keys";
import ApiManagementTab from "@/components/admin/monitor/ApiManagementTab";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import StatCard from "@/components/ui/stat-card";

function LLMCostSummary() {
	const { data: secrets = [], isLoading } = useQuery({
		queryKey: queryKeys.apiManagement.secrets,
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
		<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
			<StatCard
				icon={IconCoin}
				value={`¥${totalCostToday.toFixed(2)}`}
				label="今日 LLM 费用"
				color="blue"
			/>
			<StatCard
				icon={IconTrendingUp}
				value={`¥${totalCostMonth.toFixed(2)}`}
				label="本月 LLM 费用"
				color="teal"
			/>
			<StatCard
				icon={IconCpu}
				value={totalCallsToday}
				label="今日调用次数"
				color="amber"
			/>
			<StatCard
				icon={IconCoin}
				value={`${budgetPct}%`}
				label={`月度预算 (¥${totalMonthlyLimit.toFixed(0)})`}
				color={Number(budgetPct) > 90 ? "red" : "green"}
			/>
		</SimpleGrid>
	);
}

export default function LLMAPITab() {
	return (
		<Stack gap="xl" mt="md">
			<LLMCostSummary />
			<ApiManagementTab />
		</Stack>
	);
}
