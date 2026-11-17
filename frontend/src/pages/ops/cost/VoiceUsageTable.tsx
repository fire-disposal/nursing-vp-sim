import { Box, Group, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { fetchVoiceUsage, type VoiceUsageItem, type VoiceUsageResponse } from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

interface VoiceUsageTableProps {
	/** 取哪一路统计：TTS 与 ASR 各一份，互不混算。 */
	direction: "tts" | "asr";
	title: string;
	icon: IconType;
	/**
	 * ASR 按小时计费，字符列对它没有意义（`total_chars` 在 ASR 侧是 0）。
	 * TTS 仍按字符计费，所以列由调用方决定而不是在表里判方向。
	 */
	charColumn?: boolean;
}

/**
 * 语音用量表 —— TTS 与 ASR 共用。
 * 今日/本月 × 调用/成功/失败/字符/费用；桌面表格、移动端卡片，空态一致。
 */
export default function VoiceUsageTable({ direction, title, icon, charColumn = true }: VoiceUsageTableProps) {
	const { data: usage } = useQuery({
		queryKey: queryKeys.voice.usage,
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});

	const pick = (u: VoiceUsageResponse): [string, VoiceUsageItem][] =>
		direction === "asr"
			? [
					["今日", u.asr_today],
					["本月", u.asr_month],
				]
			: [
					["今日", u.tts_today],
					["本月", u.tts_month],
				];

	const rows = (usage ? pick(usage) : []).map(([label, item]) => ({ label, ...item }));

	return (
		<Card>
			<CardHeader>
				<Text fw={600} size="md" lh={1.35}>{title}</Text>
			</CardHeader>
			<CardContent>
				{rows.length === 0 ? (
					<EmptyState icon={icon} title="暂无数据" />
				) : (
					<>
						<Box visibleFrom="sm">
							<Table>
								<Table.Thead>
									<Table.Tr>
										<Table.Th>周期</Table.Th>
										<Table.Th style={{ textAlign: "right" }}>调用</Table.Th>
										<Table.Th style={{ textAlign: "right" }}>成功</Table.Th>
										<Table.Th style={{ textAlign: "right" }}>失败</Table.Th>
										{charColumn && <Table.Th style={{ textAlign: "right" }}>字符</Table.Th>}
										<Table.Th style={{ textAlign: "right" }}>费用</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{rows.map((row) => (
										<Table.Tr key={row.label}>
											<Table.Td style={{ fontWeight: 500 }}>{row.label}</Table.Td>
											<Table.Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.calls_total}</Table.Td>
											<Table.Td style={{ textAlign: "right", color: "var(--mantine-color-green-6)", fontVariantNumeric: "tabular-nums" }}>{row.calls_success}</Table.Td>
											<Table.Td style={{ textAlign: "right", color: "var(--mantine-color-red-6)", fontVariantNumeric: "tabular-nums" }}>{row.calls_error}</Table.Td>
											{charColumn && (
												<Table.Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.total_chars.toLocaleString()}</Table.Td>
											)}
											<Table.Td style={{ textAlign: "right", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>¥{row.cost_estimated.toFixed(4)}</Table.Td>
										</Table.Tr>
									))}
								</Table.Tbody>
							</Table>
						</Box>
						<Stack gap={8} hiddenFrom="sm">
							{rows.map((row) => (
								<Stack key={row.label} gap={4} style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, padding: 12 }}>
									<Text size="sm" fw={500}>{row.label}</Text>
									<Group gap={16} wrap="wrap">
										<Text size="xs" c="dimmed">调用 {row.calls_total}</Text>
										<Text size="xs" c="green">成功 {row.calls_success}</Text>
										<Text size="xs" c="red">失败 {row.calls_error}</Text>
										{charColumn && <Text size="xs" c="dimmed">字符 {row.total_chars.toLocaleString()}</Text>}
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
