import { SimpleGrid, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconCurrencyDollar, IconHash, IconMicrophone, IconPercentage } from "@tabler/icons-react";
import { fetchVoiceUsage } from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import StatCard from "@/components/ui/stat-card";
import VoiceASRTokenCard from "./VoiceASRTokenCard";
import VoiceUsageTable from "./VoiceUsageTable";

/**
 * ASR 管理页签。
 *
 * 与 TTS 页签同构（今日/本月费用、今日调用、今日成功率 + 配置卡 + 使用统计），
 * 但**有意不含** TTS 的月度预算卡：预算是 TTS 字符预算，`monthly_used` 也只统计 TTS，
 * 拿它给 ASR 画进度条会读成「ASR 超预算」的错误结论。
 */
export default function VoiceASRTab() {
	const { data: usage } = useQuery({
		queryKey: queryKeys.voice.usage,
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});

	const asrToday = usage?.asr_today;
	const asrMonth = usage?.asr_month;

	const todaySuccessRate = asrToday && asrToday.calls_total > 0
		? `${((asrToday.calls_success / asrToday.calls_total) * 100).toFixed(1)}%`
		: "0%";

	return (
		<Stack gap="xl" mt="md">
			<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
				<StatCard icon={IconCurrencyDollar} value={`¥${(asrToday?.cost_estimated ?? 0).toFixed(2)}`} label="今日费用" color="blue" />
				<StatCard icon={IconCurrencyDollar} value={`¥${(asrMonth?.cost_estimated ?? 0).toFixed(2)}`} label="本月费用" color="blue" />
				<StatCard icon={IconHash} value={asrToday?.calls_total ?? 0} label="今日调用" color="amber" />
				<StatCard icon={IconPercentage} value={todaySuccessRate} label="今日成功率" color="green" />
			</SimpleGrid>

			<VoiceASRTokenCard />

			<VoiceUsageTable direction="asr" title="ASR 使用统计" icon={IconMicrophone} charColumn={false} />
		</Stack>
	);
}
