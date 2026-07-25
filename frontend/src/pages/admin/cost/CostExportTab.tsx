import { useQuery } from "@tanstack/react-query";
import { Download, FileJson, FileSpreadsheet, Search } from "lucide-react";
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
import { cn } from "@/utils/cn";

const selectClass =
	"flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

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
		<div className="space-y-6 mt-4">
			<Card>
				<CardHeader>
					<CardTitle>导出筛选</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
						<div className="space-y-1.5">
							<Label htmlFor="startDate">开始日期</Label>
							<Input
								id="startDate"
								type="date"
								value={startDate}
								onChange={(e) => setStartDate(e.target.value)}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="endDate">结束日期</Label>
							<Input
								id="endDate"
								type="date"
								value={endDate}
								onChange={(e) => setEndDate(e.target.value)}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="service">服务类型</Label>
							<select
								id="service"
								value={service ?? ""}
								onChange={(e) =>
									setService(e.target.value || null)
								}
								className={selectClass}
							>
								<option value="">全部</option>
								<option value="llm">LLM</option>
								<option value="tts">TTS</option>
							</select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="granularity">粒度</Label>
							<select
								id="granularity"
								value={granularity}
								onChange={(e) => setGranularity(e.target.value)}
								className={selectClass}
							>
								<option value="daily">按日</option>
								<option value="monthly">按月</option>
							</select>
						</div>
					</div>

					<Separator />

					<div className="flex items-center justify-between flex-wrap gap-3">
						<div className="inline-flex items-center rounded-lg border border-border bg-muted p-0.5">
							<button
								type="button"
								onClick={() => setFormat("json")}
								className={cn(
									"inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
									format === "json"
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<FileJson className="size-3.5" />
								JSON
							</button>
							<button
								type="button"
								onClick={() => setFormat("csv")}
								className={cn(
									"inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
									format === "csv"
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<FileSpreadsheet className="size-3.5" />
								CSV
							</button>
						</div>

						<Button onClick={handleFetch} disabled={isFetching}>
							<Search className="size-4" />
							查询
						</Button>
					</div>
				</CardContent>
			</Card>

			{isLoading || isFetching ? (
				<LoadingSkeleton />
			) : data ? (
				<Card>
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle>导出结果</CardTitle>
						<Button
							variant="outline"
							size="sm"
							onClick={downloadCSV}
						>
							<Download className="size-3.5" />
							下载 CSV
						</Button>
					</CardHeader>
					<CardContent>
						{items.length === 0 ? (
							<EmptyState
								title="无数据"
								description="所选范围内没有费用记录"
							/>
						) : (
							<>
								{summary && (
									<div className="flex items-center gap-6 mb-4 px-1 text-sm">
										<div>
											<span className="text-muted-foreground">总费用 </span>
											<span className="font-semibold tabular-nums">
												¥{summary.total_cost.toFixed(4)}
											</span>
										</div>
										<div>
											<span className="text-muted-foreground">总调用 </span>
											<span className="font-semibold tabular-nums">
												{summary.total_calls}
											</span>
										</div>
									</div>
								)}
								<div className="max-h-96 overflow-auto rounded-md border">
									<Table>
										<TableHeader>
											<TableRow>
												{Object.keys(items[0]).map((k) => (
													<TableHead key={k} className="whitespace-nowrap">
														{k}
													</TableHead>
												))}
											</TableRow>
										</TableHeader>
										<TableBody>
											{items.map((item, i) => (
												<TableRow key={i}>
													{Object.keys(items[0]).map((k) => (
														<TableCell key={k} className="whitespace-nowrap">
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
		</div>
	);
}
