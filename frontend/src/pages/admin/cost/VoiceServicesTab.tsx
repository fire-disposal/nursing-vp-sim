import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mic, Play, Save, Volume2 } from "lucide-react";
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

const VOICE_TYPES = [
	"zh_female_vv",
	"zh_male_vv",
	"zh_female_qingxin",
	"zh_male_qingse",
	"zh_female_shuangkuai",
	"zh_male_yingjun",
];

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
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
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
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
						>
							<option value={8000}>8000</option>
							<option value={16000}>16000</option>
							<option value={22050}>22050</option>
							<option value={44100}>44100</option>
							<option value={48000}>48000</option>
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

				<div className="flex gap-2 flex-wrap">
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
					<Button
						variant="outline"
						onClick={async () => {
							try {
								const r = await testTTS();
								r.data.ok
									? toast.success(
											`TTS 测试通过 (${r.data.latency_ms}ms)`,
										)
									: toast.error(r.data.error || "TTS 测试失败");
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
								r.data.ok
									? toast.success(
											`ASR 测试通过 (${r.data.latency_ms}ms)`,
										)
									: toast.error(r.data.error || "ASR 测试失败");
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
			</CardContent>
		</Card>
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
			<CardHeader>
				<CardTitle>使用统计</CardTitle>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>服务</TableHead>
							<TableHead>周期</TableHead>
							<TableHead>总调用</TableHead>
							<TableHead>成功</TableHead>
							<TableHead>失败</TableHead>
							<TableHead>预估费用</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						<TableRow>
							<TableCell className="font-medium">TTS</TableCell>
							<TableCell>今日</TableCell>
							<TableCell>{usage.tts_today.calls_total}</TableCell>
							<TableCell>{usage.tts_today.calls_success}</TableCell>
							<TableCell>{usage.tts_today.calls_error}</TableCell>
							<TableCell>
								¥{usage.tts_today.cost_estimated.toFixed(4)}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="font-medium">TTS</TableCell>
							<TableCell>本月</TableCell>
							<TableCell>{usage.tts_month.calls_total}</TableCell>
							<TableCell>
								{usage.tts_month.calls_success}
							</TableCell>
							<TableCell>{usage.tts_month.calls_error}</TableCell>
							<TableCell>
								¥{usage.tts_month.cost_estimated.toFixed(4)}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="font-medium">ASR</TableCell>
							<TableCell>今日</TableCell>
							<TableCell>{usage.asr_today.calls_total}</TableCell>
							<TableCell>
								{usage.asr_today.calls_success}
							</TableCell>
							<TableCell>{usage.asr_today.calls_error}</TableCell>
							<TableCell>
								¥{usage.asr_today.cost_estimated.toFixed(4)}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="font-medium">ASR</TableCell>
							<TableCell>本月</TableCell>
							<TableCell>{usage.asr_month.calls_total}</TableCell>
							<TableCell>
								{usage.asr_month.calls_success}
							</TableCell>
							<TableCell>{usage.asr_month.calls_error}</TableCell>
							<TableCell>
								¥{usage.asr_month.cost_estimated.toFixed(4)}
							</TableCell>
						</TableRow>
					</TableBody>
				</Table>
				{usage.monthly_budget > 0 && (
					<div className="mt-3 text-xs text-muted-foreground">
						月度预算: ¥{usage.monthly_budget.toFixed(0)} / 已用: ¥
						{usage.monthly_used.toFixed(2)}
					</div>
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
