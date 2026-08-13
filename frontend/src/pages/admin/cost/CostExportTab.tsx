import { Group, SegmentedControl, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconDownload, IconFileSpreadsheet, IconJson, IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { fetchCostExport } from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export default function CostExportTab() {
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [service, setService] = useState<string | null>(null);
	const [granularity, setGranularity] = useState("daily");
	const [format, setFormat] = useState("json");

	const { data, isLoading, isFetching, refetch } = useQuery({
		queryKey: queryKeys.cost.costExport(startDate, endDate, service, granularity, format),
		queryFn: () =>
			fetchCostExport({
				start_date: startDate || undefined,
				end_date: endDate || undefined,
				service,
				granularity,
				format,
			}).then((r) => r.data),
		enabled: false,
	});

	const handleFetch = () => {
		refetch();
	};

	const downloadCSV = () => {
		if (!data?.length) return;
		const headers = Object.keys(data[0]);
		const rows = data.map((item) =>
			headers.map((h) => String(item[h] ?? "")).join(","),
		);
		const csv = [headers.join(","), ...rows].join("\n");
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `cost-export-${startDate || "all"}-${endDate || "all"}.csv`;
		a.click();
		URL.revokeObjectURL(url);
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
							<Stack gap={6}>
								<Label htmlFor="startDate">开始日期</Label>
								<Input
									id="startDate"
									type="date"
									value={startDate}
									onChange={(e) => setStartDate(e.target.value)}
								/>
							</Stack>
							<Stack gap={6}>
								<Label htmlFor="endDate">结束日期</Label>
								<Input
									id="endDate"
									type="date"
									value={endDate}
									onChange={(e) => setEndDate(e.target.value)}
								/>
							</Stack>
							<Stack gap={6}>
								<Label htmlFor="service">服务类型</Label>
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
								<Label htmlFor="granularity">粒度</Label>
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

						<Separator />

						<Group justify="space-between" wrap="wrap" gap="sm">
							<SegmentedControl
								value={format}
								onChange={(v) => setFormat(v)}
								data={[
									{
										value: "json",
										label: (
											<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
												<IconJson size={14} />
												JSON
											</span>
										),
									},
									{
										value: "csv",
										label: (
											<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
												<IconFileSpreadsheet size={14} />
												CSV
											</span>
										),
									},
								]}
							/>

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
							<Button variant="outline" size="sm" onClick={downloadCSV} leftSection={<IconDownload size={14} />}>
								下载 CSV
							</Button>
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
								<div style={{ maxHeight: 384, overflow: "auto", border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}>
									<Table>
										<TableHeader>
											<TableRow>
												{Object.keys(items[0]).map((k) => (
													<TableHead key={k} style={{ whiteSpace: "nowrap" }}>
														{k}
													</TableHead>
												))}
											</TableRow>
										</TableHeader>
										<TableBody>
											{items.map((item, i) => (
												<TableRow key={i}>
													{Object.keys(items[0]).map((k) => (
														<TableCell key={k} style={{ whiteSpace: "nowrap" }}>
															{String(item[k] ?? "")}
														</TableCell>
													))}
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
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
