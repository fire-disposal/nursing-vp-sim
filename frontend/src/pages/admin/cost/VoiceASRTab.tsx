import { useQuery } from "@tanstack/react-query";
import { Mic } from "lucide-react";
import {
	fetchVoiceUsage,
	testASR,
} from "@/api/admin/voice-cost";
import { useToast } from "@/components/Toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/ui/StatCard";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import VoiceTokenCard from "./VoiceTokenCard";

function ASRUsageTable() {
	const { data: usage } = useQuery({
		queryKey: ["admin", "voice", "usage"],
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});

	const asrData = usage
		? [
				{ label: "今日", ...usage.asr_today },
				{ label: "本月", ...usage.asr_month },
			]
		: [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>ASR 使用统计</CardTitle>
			</CardHeader>
			<CardContent>
				{asrData.length === 0 ? (
					<div className="text-muted-foreground text-sm text-center py-4">
						暂无数据
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>周期</TableHead>
								<TableHead className="text-right">总调用</TableHead>
								<TableHead className="text-right">成功</TableHead>
								<TableHead className="text-right">失败</TableHead>
								<TableHead className="text-right">字符数</TableHead>
								<TableHead className="text-right">预估费用</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{asrData.map((row) => (
								<TableRow key={row.label}>
									<TableCell className="font-medium">
										{row.label}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{row.calls_total}
									</TableCell>
									<TableCell className="text-right tabular-nums text-emerald-600">
										{row.calls_success}
									</TableCell>
									<TableCell className="text-right tabular-nums text-danger-foreground">
										{row.calls_error}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{row.total_chars.toLocaleString()}
									</TableCell>
									<TableCell className="text-right tabular-nums font-medium">
										¥{row.cost_estimated.toFixed(4)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

export default function VoiceASRTab() {
	const { data: usage } = useQuery({
		queryKey: ["admin", "voice", "usage"],
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});
	const toast = useToast();

	const asrToday = usage?.asr_today;
	const asrMonth = usage?.asr_month;

	return (
		<div className="space-y-6 mt-4">
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					icon={Mic}
					value={`¥${(asrToday?.cost_estimated ?? 0).toFixed(2)}`}
					label="今日 ASR 费用"
					color="amber"
				/>
				<StatCard
					icon={Mic}
					value={`¥${(asrMonth?.cost_estimated ?? 0).toFixed(2)}`}
					label="本月 ASR 费用"
					color="blue"
				/>
				<StatCard
					icon={Mic}
					value={asrToday?.calls_total ?? 0}
					label="今日 ASR 调用"
					color="teal"
				/>
				<StatCard
					icon={Mic}
					value={asrToday
						? `${asrToday.calls_total > 0 ? ((asrToday.calls_success / asrToday.calls_total) * 100).toFixed(1) : 0}%`
						: "0%"}
					label="今日成功率"
					color="green"
				/>
			</div>

			<VoiceTokenCard
				onTest={async () => {
					try {
						const r = await testASR();
						if (r.data.asr_online) {
							toast.success("ASR 测试通过");
						} else {
							toast.error(r.data.last_error || "ASR 测试失败");
						}
					} catch (e: unknown) {
						toast.apiError(e, "ASR 测试失败");
					}
				}}
				testLabel="测试 ASR"
				TestIcon={Mic}
			/>

			<ASRUsageTable />
		</div>
	);
}
