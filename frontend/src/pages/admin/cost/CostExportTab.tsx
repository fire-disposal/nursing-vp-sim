import { useQuery } from "@tanstack/react-query";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { fetchCostExport } from "@/api/admin/voice-cost";
import Button from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
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
		queryKey: ["admin", "cost", "export", startDate, endDate, service, granularity, format],
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
								className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
							>
								<option value="">全部</option>
								<option value="llm">LLM</option>
								<option value="tts">TTS</option>
								<option value="asr">ASR</option>
							</select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="granularity">粒度</Label>
							<select
								id="granularity"
								value={granularity}
								onChange={(e) => setGranularity(e.target.value)}
								className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
							>
								<option value="daily">按日</option>
								<option value="monthly">按月</option>
							</select>
						</div>
					</div>

					<Separator />

					<div className="flex gap-2 flex-wrap items-center">
						<div className="flex gap-1 items-center border border-border rounded-md p-0.5">
							<button
								type="button"
								onClick={() => setFormat("json")}
								className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${
									format === "json"
										? "bg-primary text-primary-foreground"
										: "hover:bg-muted"
								}`}
							>
								<FileJson className="size-3.5" />
								JSON
							</button>
							<button
								type="button"
								onClick={() => setFormat("csv")}
								className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${
									format === "csv"
										? "bg-primary text-primary-foreground"
										: "hover:bg-muted"
								}`}
							>
								<FileSpreadsheet className="size-3.5" />
								CSV
							</button>
						</div>

						<Button onClick={handleFetch} disabled={isFetching}>
							查询
						</Button>
					</div>
				</CardContent>
			</Card>

			{isLoading || isFetching ? (
				<LoadingSkeleton />
			) : data ? (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center justify-between">
							<span>导出结果</span>
							<div className="flex gap-2">
								{summary && (
									<span className="text-xs text-muted-foreground font-normal">
										总计 ¥{summary.total_cost.toFixed(4)} /{" "}
										{summary.total_calls} 次调用
									</span>
								)}
								<Button
									variant="outline"
									size="sm"
									onClick={downloadCSV}
								>
									<Download className="size-3.5" />
									下载 CSV
								</Button>
							</div>
						</CardTitle>
					</CardHeader>
					<CardContent>
						{items.length === 0 ? (
							<EmptyState
								title="无数据"
								description="所选范围内没有费用记录"
							/>
						) : (
							<div className="max-h-96 overflow-auto">
								<Table>
									<TableHeader>
										<TableRow>
											{Object.keys(items[0]).map((k) => (
												<TableHead key={k}>{k}</TableHead>
											))}
										</TableRow>
									</TableHeader>
									<TableBody>
										{items.map((item, i) => (
											<TableRow key={i}>
												{Object.keys(items[0]).map((k) => (
													<TableCell key={k}>
														{String(item[k] ?? "")}
													</TableCell>
												))}
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
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
