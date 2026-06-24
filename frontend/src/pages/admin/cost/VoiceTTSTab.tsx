import { useQuery } from "@tanstack/react-query";
import { Volume2 } from "lucide-react";
import {
	fetchVoiceUsage,
	testTTS,
} from "@/api/admin/voice-cost";
import { useToast } from "@/components/Toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
		queryKey: ["admin", "voice", "usage"],
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
				<CardTitle>TTS 使用统计</CardTitle>
			</CardHeader>
			<CardContent>
				{ttsData.length === 0 ? (
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
							{ttsData.map((row) => (
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

export default function VoiceTTSTab() {
	const { data: usage } = useQuery({
		queryKey: ["admin", "voice", "usage"],
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});
	const toast = useToast();

	const ttsToday = usage?.tts_today;
	const ttsMonth = usage?.tts_month;

	return (
		<div className="space-y-6 mt-4">
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					icon={Volume2}
					value={`¥${(ttsToday?.cost_estimated ?? 0).toFixed(2)}`}
					label="今日 TTS 费用"
					color="teal"
				/>
				<StatCard
					icon={Volume2}
					value={`¥${(ttsMonth?.cost_estimated ?? 0).toFixed(2)}`}
					label="本月 TTS 费用"
					color="blue"
				/>
				<StatCard
					icon={Volume2}
					value={ttsToday?.calls_total ?? 0}
					label="今日 TTS 调用"
					color="amber"
				/>
				<StatCard
					icon={Volume2}
					value={ttsToday
						? `${ttsToday.calls_total > 0 ? ((ttsToday.calls_success / ttsToday.calls_total) * 100).toFixed(1) : 0}%`
						: "0%"}
					label="今日成功率"
					color="green"
				/>
			</div>

			<VoiceTokenCard
				onTest={async () => {
					try {
						const r = await testTTS();
						if (r.data.tts_online) {
							toast.success("TTS 测试通过");
						} else {
							toast.error(r.data.last_error || "TTS 测试失败");
						}
					} catch (e: unknown) {
						toast.apiError(e, "TTS 测试失败");
					}
				}}
				testLabel="测试 TTS"
				TestIcon={Volume2}
			/>

			<TTSUsageTable />
		</div>
	);
}
