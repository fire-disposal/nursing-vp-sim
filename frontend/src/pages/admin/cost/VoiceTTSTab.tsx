import { Box, Group, Progress, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconCurrencyDollar, IconHash, IconPercentage, IconVolume2 } from "@tabler/icons-react";
import { fetchVoiceUsage } from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import StatCard from "@/components/ui/stat-card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import VoiceTokenCard from "./VoiceTokenCard";

function TTSUsageTable() {
	const { data: usage } = useQuery({
		queryKey: queryKeys.voice.usage,
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});

	const ttsData = usage
		? [
				{ label: "今日", ...usage.tts_today },
				{ label: "本月", ...usage.tts_month },
			]
		: [];

	return (
		<Card>
			<CardHeader>
				<Text fw={600} size="md" lh={1.35}>TTS 使用统计</Text>
			</CardHeader>
			<CardContent>
				{ttsData.length === 0 ? (
					<EmptyState icon={IconVolume2} title="暂无数据" />
				) : (
					<>
						<Box visibleFrom="sm">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>周期</TableHead>
										<TableHead style={{ textAlign: "right" }}>调用</TableHead>
										<TableHead style={{ textAlign: "right" }}>成功</TableHead>
										<TableHead style={{ textAlign: "right" }}>失败</TableHead>
										<TableHead style={{ textAlign: "right" }}>字符</TableHead>
										<TableHead style={{ textAlign: "right" }}>费用</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{ttsData.map((row) => (
										<TableRow key={row.label}>
											<TableCell style={{ fontWeight: 500 }}>{row.label}</TableCell>
											<TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.calls_total}</TableCell>
											<TableCell style={{ textAlign: "right", color: "var(--mantine-color-green-6)", fontVariantNumeric: "tabular-nums" }}>{row.calls_success}</TableCell>
											<TableCell style={{ textAlign: "right", color: "var(--mantine-color-red-6)", fontVariantNumeric: "tabular-nums" }}>{row.calls_error}</TableCell>
											<TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.total_chars.toLocaleString()}</TableCell>
											<TableCell style={{ textAlign: "right", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>¥{row.cost_estimated.toFixed(4)}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</Box>
						<Stack gap={8} hiddenFrom="sm">
							{ttsData.map((row) => (
								<Stack key={row.label} gap={4} style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, padding: 12 }}>
									<Text size="sm" fw={500}>{row.label}</Text>
									<Group gap={16} wrap="wrap">
										<Text size="xs" c="dimmed">调用 {row.calls_total}</Text>
										<Text size="xs" c="green">成功 {row.calls_success}</Text>
										<Text size="xs" c="red">失败 {row.calls_error}</Text>
										<Text size="xs" c="dimmed">字符 {row.total_chars.toLocaleString()}</Text>
										<Text size="xs" fw={500}>¥{row.cost_estimated.toFixed(4)}</Text>
									</Group>
								</Stack>
							))}
						</Stack>
					</>
				)}
			</CardContent>
		</Card>
	);
}

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
				<StatCard icon={IconCurrencyDollar} value={`¥${(ttsToday?.cost_estimated ?? 0).toFixed(2)}`} label="今日费用" color="teal" />
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

			<TTSUsageTable />
		</Stack>
	);
}
