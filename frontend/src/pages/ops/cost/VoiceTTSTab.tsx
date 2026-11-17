import { Group, Progress, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconCurrencyDollar, IconHash, IconPercentage, IconVolume2 } from "@tabler/icons-react";
import { fetchVoiceUsage } from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import StatCard from "@/components/ui/stat-card";
import VoiceTokenCard from "./VoiceTokenCard";
import VoiceUsageTable from "./VoiceUsageTable";

export default function VoiceTTSTab() {
	const { data: usage } = useQuery({
		queryKey: queryKeys.voice.usage,
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});

	const ttsToday = usage?.tts_today;
	const ttsMonth = usage?.tts_month;
	const budget = usage?.monthly_budget ?? 0;
	const monthUsed = usage?.monthly_used ?? 0;
	const budgetUsed = budget > 0 ? Math.min(100, Math.round((monthUsed / budget) * 100)) : 0;

	const todaySuccessRate = ttsToday && ttsToday.calls_total > 0
		? `${((ttsToday.calls_success / ttsToday.calls_total) * 100).toFixed(1)}%`
		: "0%";

	return (
		<Stack gap="xl" mt="md">
			<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
				<StatCard icon={IconCurrencyDollar} value={`¥${(ttsToday?.cost_estimated ?? 0).toFixed(2)}`} label="今日费用" color="blue" />
				<StatCard icon={IconCurrencyDollar} value={`¥${(ttsMonth?.cost_estimated ?? 0).toFixed(2)}`} label="本月费用" color="blue" />
				<StatCard icon={IconHash} value={ttsToday?.calls_total ?? 0} label="今日调用" color="amber" />
				<StatCard icon={IconPercentage} value={todaySuccessRate} label="今日成功率" color="green" />
			</SimpleGrid>

			{budget > 0 && (
				<Card>
					<CardHeader>
						<Group gap={8} wrap="nowrap">
							<IconVolume2 size={15} style={{ color: "var(--mantine-color-dimmed)" }} />
							<Text size="sm" fw={600}>月度预算</Text>
							<Text size="sm" c="dimmed">¥{monthUsed.toFixed(2)} / ¥{budget.toFixed(0)}</Text>
						</Group>
					</CardHeader>
					<CardContent>
						<Progress
							value={budgetUsed}
							size="sm"
							radius="md"
							color={budgetUsed > 90 ? "red" : budgetUsed > 70 ? "yellow" : "green"}
						/>
						<Text size="xs" c="dimmed" ta="right" mt={4}>{budgetUsed}%</Text>
					</CardContent>
				</Card>
			)}

			<VoiceTokenCard />

			<VoiceUsageTable direction="tts" title="TTS 使用统计" icon={IconVolume2} />
		</Stack>
	);
}
