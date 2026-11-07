import { Button, Group, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconDownload, IconFileSpreadsheet, IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { downloadCostExport, fetchCostExport } from "@/api/admin/voice-cost";
import { downloadBlobResponse } from "@/api/download";
import { queryKeys } from "@/api/query-keys";
import { toast } from "@/components/Toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import TableScroll from "@/components/ui/table-scroll";

import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { Divider } from "@mantine/core";
import { Table } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";

export default function CostExportTab() {
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [service, setService] = useState<string | null>(null);
	const [granularity, setGranularity] = useState("daily");

	const { data, isLoading, isFetching, refetch } = useQuery({
		queryKey: queryKeys.cost.costExport(startDate, endDate, service, granularity, "json"),
		queryFn: () =>
			fetchCostExport({
				start_date: startDate || undefined,
				end_date: endDate || undefined,
				service,
				granularity,
				format: "json",
			}).then((r) => r.data),
		enabled: false,
	});

	const handleFetch = () => {
		refetch();
	};

	const download = async (fmt: "csv" | "xlsx") => {
		try {
			const resp = await downloadCostExport(
				{ start_date: startDate, end_date: endDate, service: service ?? "", granularity },
				fmt,
			);
			downloadBlobResponse(resp, `成本明细.${fmt}`);
		} catch (e) {
			toast.apiError(e, "导出失败");
		}
	};

	const items = data ?? [];
	const summary = items.length > 0
		? {
				total_cost: items.reduce((sum, r) => sum + (Number(r.cost) || 0), 0),
				total_calls: items.reduce((sum, r) => sum + (Number(r.calls) || 0), 0),
			}
		: null;

	return (
		<Stack gap="xl" mt="md">
			<Card>
				<CardHeader>
					<CardTitle>导出筛选</CardTitle>
				</CardHeader>
				<CardContent>
					<Stack gap="md">
						<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
							<DatePickerInput
								label="开始日期"
								clearable
								valueFormat="YYYY-MM-DD"
								placeholder="不限"
								value={startDate || null}
								onChange={(v) => setStartDate(typeof v === "string" ? v : "")}
							/>
							<DatePickerInput
								label="结束日期"
								clearable
								valueFormat="YYYY-MM-DD"
								placeholder="不限"
								value={endDate || null}
								onChange={(v) => setEndDate(typeof v === "string" ? v : "")}
							/>
							<Stack gap={6}>
								<label htmlFor="service">服务类型</label>
								<Select
									id="service"
									value={service ?? ""}
									onChange={(v) => setService(v || null)}
									data={[
										{ value: "", label: "全部" },
										{ value: "llm", label: "LLM" },
										{ value: "tts", label: "TTS" },
									]}
								/>
							</Stack>
							<Stack gap={6}>
								<label htmlFor="granularity">粒度</label>
								<Select
									id="granularity"
									value={granularity}
									onChange={(v) => setGranularity(v ?? "daily")}
									data={[
										{ value: "daily", label: "按日" },
										{ value: "monthly", label: "按月" },
									]}
								/>
							</Stack>
						</SimpleGrid>

						<Divider />

						<Group justify="flex-end" wrap="wrap" gap="sm">
							<Button onClick={handleFetch} disabled={isFetching} leftSection={<IconSearch size={16} />}>
								查询
							</Button>
						</Group>
					</Stack>
				</CardContent>
			</Card>

			{isLoading || isFetching ? (
				<LoadingSkeleton />
			) : data ? (
				<Card>
					<CardHeader>
						<Group justify="space-between" align="center" wrap="wrap">
							<CardTitle>导出结果</CardTitle>
							<Group gap="xs">
								<Button variant="outline" size="sm" onClick={() => download("csv")} leftSection={<IconDownload size={14} />}>
									下载 CSV
								</Button>
								<Button variant="outline" size="sm" onClick={() => download("xlsx")} leftSection={<IconFileSpreadsheet size={14} />}>
									下载 XLSX
								</Button>
							</Group>
						</Group>
					</CardHeader>
					<CardContent>
						{items.length === 0 ? (
							<EmptyState title="无数据" description="所选范围内没有费用记录" />
						) : (
							<>
								{summary && (
									<Group gap={24} mb="md" px={4}>
										<Text size="sm">
											<Text component="span" c="dimmed" inherit>总费用 </Text>
											<Text component="span" fw={600} inherit style={{ fontVariantNumeric: "tabular-nums" }}>
												¥{summary.total_cost.toFixed(4)}
											</Text>
										</Text>
										<Text size="sm">
											<Text component="span" c="dimmed" inherit>总调用 </Text>
											<Text component="span" fw={600} inherit style={{ fontVariantNumeric: "tabular-nums" }}>
												{summary.total_calls}
											</Text>
										</Text>
									</Group>
								)}
								<TableScroll
									minWidth={720}
									maxHeight={384}
									style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}
								>
									<Table>
										<Table.Thead>
											<Table.Tr>
												{Object.keys(items[0]).map((k) => (
													<Table.Th key={k} style={{ whiteSpace: "nowrap" }}>
														{k}
													</Table.Th>
												))}
											</Table.Tr>
										</Table.Thead>
										<Table.Tbody>
											{items.map((item, i) => (
												<Table.Tr key={i}>
													{Object.keys(items[0]).map((k) => (
														<Table.Td key={k} style={{ whiteSpace: "nowrap" }}>
															{String(item[k] ?? "")}
														</Table.Td>
													))}
												</Table.Tr>
											))}
										</Table.Tbody>
									</Table>
								</TableScroll>
							</>
						)}
					</CardContent>
				</Card>
			) : (
				<EmptyState
					title="导出费用数据"
					description="选择日期范围和服务类型，点击查询"
				/>
			)}
		</Stack>
	);
}
