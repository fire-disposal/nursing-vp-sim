import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mic, Save, Volume2, Zap } from "lucide-react";
import { useState } from "react";
import {
	fetchVoiceConfig,
	fetchVoiceUsage,
	testASR,
	testTTS,
	updateVoiceConfig,
	type VoiceConfigResponse,
} from "@/api/admin/voice-cost";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const VOICE_TYPES = [
	"zh_female_vv",
	"zh_male_vv",
	"zh_female_qingxin",
	"zh_male_qingse",
	"zh_female_shuangkuai",
	"zh_male_yingjun",
];

const selectClass =
	"flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function ConfigCard() {
	const toast = useToast();
	const queryClient = useQueryClient();
	const { data: config, isLoading } = useQuery({
		queryKey: ["admin", "voice", "config"],
		queryFn: () => fetchVoiceConfig().then((r) => r.data),
		staleTime: 60_000,
	});

	const saveMutation = useMutation({
		mutationFn: (data: Parameters<typeof updateVoiceConfig>[0]) =>
			updateVoiceConfig(data).then((r) => r.data),
		onSuccess: () => {
			toast.success("配置已保存");
			queryClient.invalidateQueries({
				queryKey: ["admin", "voice", "config"],
			});
		},
		onError: (e: unknown) => {
			const err = e as { response?: { data?: { detail?: string } } };
			toast.error(err.response?.data?.detail || "保存失败");
		},
	});

	const [form, setForm] = useState({
		app_id: "",
		token: "",
		tts_voice_type: "zh_female_vv",
		asr_sample_rate: 16000,
		monthly_budget: 200,
	});

	const initForm = (c: VoiceConfigResponse | undefined) => {
		if (c) {
			setForm({
				app_id: c.app_id || "",
				token: "",
				tts_voice_type: c.tts_voice_type || "zh_female_vv",
				asr_sample_rate: c.asr_sample_rate || 16000,
				monthly_budget: c.monthly_budget || 200,
			});
		}
	};

	const isInit = useState(false);
	if (!isInit[0] && config && !isLoading) {
		initForm(config);
		isInit[1](true);
	}

	if (isLoading) return <LoadingSkeleton />;
	if (!config) {
		return (
			<EmptyState
				title="无语音服务配置"
				description="请在下方创建配置"
			/>
		);
	}

	const handleSave = () => {
		saveMutation.mutate({
			app_id: form.app_id,
			token: form.token || undefined,
			tts_voice_type: form.tts_voice_type,
			asr_sample_rate: form.asr_sample_rate,
			monthly_budget: form.monthly_budget,
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>语音服务配置</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="app_id">App ID</Label>
						<Input
							id="app_id"
							value={form.app_id}
							onChange={(e) =>
								setForm((f) => ({ ...f, app_id: e.target.value }))
							}
							placeholder="输入 App ID"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="token">
							Token{" "}
							<span className="text-muted-foreground text-xs">
								(留空不修改)
							</span>
						</Label>
						<Input
							id="token"
							type="password"
							value={form.token}
							onChange={(e) =>
								setForm((f) => ({ ...f, token: e.target.value }))
							}
							placeholder={config.token_masked || "输入新 Token"}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="tts_voice_type">TTS 语音类型</Label>
						<select
							id="tts_voice_type"
							value={form.tts_voice_type}
							onChange={(e) =>
								setForm((f) => ({
									...f,
									tts_voice_type: e.target.value,
								}))
							}
							className={selectClass}
						>
							{VOICE_TYPES.map((vt) => (
								<option key={vt} value={vt}>
									{vt}
								</option>
							))}
						</select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="asr_sample_rate">ASR 采样率</Label>
						<select
							id="asr_sample_rate"
							value={form.asr_sample_rate}
							onChange={(e) =>
								setForm((f) => ({
									...f,
									asr_sample_rate: Number(e.target.value),
								}))
							}
							className={selectClass}
						>
							<option value={8000}>8000 Hz</option>
							<option value={16000}>16000 Hz</option>
							<option value={22050}>22050 Hz</option>
							<option value={44100}>44100 Hz</option>
							<option value={48000}>48000 Hz</option>
						</select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="monthly_budget">月度预算 (¥)</Label>
						<Input
							id="monthly_budget"
							type="number"
							min={0}
							step={1}
							value={form.monthly_budget}
							onChange={(e) =>
								setForm((f) => ({
									...f,
									monthly_budget: Number(e.target.value),
								}))
							}
						/>
					</div>
				</div>

				<Separator />

				<div className="flex items-center justify-between flex-wrap gap-3">
					<Button
						onClick={handleSave}
						disabled={saveMutation.isPending}
					>
						{saveMutation.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Save className="size-4" />
						)}
						保存配置
					</Button>

					<div className="flex gap-2">
						<Button
							variant="outline"
							onClick={async () => {
								try {
									const r = await testTTS();
									if (r.data.tts_online) {
										toast.success("TTS 测试通过");
									} else {
										toast.error(
											r.data.last_error || "TTS 测试失败",
										);
									}
								} catch (e: unknown) {
									const err = e as {
										response?: { data?: { detail?: string } };
									};
									toast.error(
										err.response?.data?.detail || "TTS 测试失败",
									);
								}
							}}
						>
							<Volume2 className="size-4" />
							测试 TTS
						</Button>
						<Button
							variant="outline"
							onClick={async () => {
								try {
									const r = await testASR();
									if (r.data.asr_online) {
										toast.success("ASR 测试通过");
									} else {
										toast.error(
											r.data.last_error || "ASR 测试失败",
										);
									}
								} catch (e: unknown) {
									const err = e as {
										response?: { data?: { detail?: string } };
									};
									toast.error(
										err.response?.data?.detail || "ASR 测试失败",
									);
								}
							}}
						>
							<Mic className="size-4" />
							测试 ASR
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function BudgetBar({
	used,
	budget,
}: {
	used: number;
	budget: number;
}) {
	const pct = budget > 0 ? Math.min((used / budget) * 100, 100) : 0;
	const color =
		pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500";

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between text-xs">
				<span className="text-muted-foreground">预算使用率</span>
				<span className="font-medium tabular-nums">
					{pct.toFixed(1)}% · ¥{used.toFixed(0)} / ¥{budget.toFixed(0)}
				</span>
			</div>
			<div className="h-2 w-full rounded-full bg-muted overflow-hidden">
				<div
					className={cn("h-full rounded-full transition-all duration-500", color)}
					style={{ width: `${Math.max(pct, 2)}%` }}
				/>
			</div>
		</div>
	);
}

function UsageStatsCard() {
	const { data: usage, isLoading } = useQuery({
		queryKey: ["admin", "voice", "usage"],
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});

	if (isLoading) return <LoadingSkeleton />;
	if (!usage) {
		return (
			<EmptyState
				title="无使用数据"
				description="暂无语音服务使用统计"
			/>
		);
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center gap-2">
				<Zap className="size-4 text-muted-foreground" />
				<CardTitle>使用统计</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>服务</TableHead>
							<TableHead>周期</TableHead>
							<TableHead className="text-right">总调用</TableHead>
							<TableHead className="text-right">成功</TableHead>
							<TableHead className="text-right">失败</TableHead>
							<TableHead className="text-right">预估费用</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						<TableRow>
							<TableCell className="font-medium">TTS</TableCell>
							<TableCell className="text-muted-foreground">今日</TableCell>
							<TableCell className="text-right tabular-nums">{usage.tts_today.calls_total}</TableCell>
							<TableCell className="text-right tabular-nums text-emerald-600">{usage.tts_today.calls_success}</TableCell>
							<TableCell className="text-right tabular-nums text-red-500">{usage.tts_today.calls_error}</TableCell>
							<TableCell className="text-right tabular-nums font-medium">
								¥{usage.tts_today.cost_estimated.toFixed(4)}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="font-medium">TTS</TableCell>
							<TableCell className="text-muted-foreground">本月</TableCell>
							<TableCell className="text-right tabular-nums">{usage.tts_month.calls_total}</TableCell>
							<TableCell className="text-right tabular-nums text-emerald-600">{usage.tts_month.calls_success}</TableCell>
							<TableCell className="text-right tabular-nums text-red-500">{usage.tts_month.calls_error}</TableCell>
							<TableCell className="text-right tabular-nums font-medium">
								¥{usage.tts_month.cost_estimated.toFixed(4)}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="font-medium">ASR</TableCell>
							<TableCell className="text-muted-foreground">今日</TableCell>
							<TableCell className="text-right tabular-nums">{usage.asr_today.calls_total}</TableCell>
							<TableCell className="text-right tabular-nums text-emerald-600">{usage.asr_today.calls_success}</TableCell>
							<TableCell className="text-right tabular-nums text-red-500">{usage.asr_today.calls_error}</TableCell>
							<TableCell className="text-right tabular-nums font-medium">
								¥{usage.asr_today.cost_estimated.toFixed(4)}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="font-medium">ASR</TableCell>
							<TableCell className="text-muted-foreground">本月</TableCell>
							<TableCell className="text-right tabular-nums">{usage.asr_month.calls_total}</TableCell>
							<TableCell className="text-right tabular-nums text-emerald-600">{usage.asr_month.calls_success}</TableCell>
							<TableCell className="text-right tabular-nums text-red-500">{usage.asr_month.calls_error}</TableCell>
							<TableCell className="text-right tabular-nums font-medium">
								¥{usage.asr_month.cost_estimated.toFixed(4)}
							</TableCell>
						</TableRow>
					</TableBody>
				</Table>

				{usage.monthly_budget > 0 && (
					<BudgetBar
						used={usage.monthly_used}
						budget={usage.monthly_budget}
					/>
				)}
			</CardContent>
		</Card>
	);
}

export default function VoiceServicesTab() {
	return (
		<div className="space-y-6 mt-4">
			<ConfigCard />
			<UsageStatsCard />
		</div>
	);
}
