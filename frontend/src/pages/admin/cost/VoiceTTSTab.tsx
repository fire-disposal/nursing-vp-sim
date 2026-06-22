import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Save, Upload, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import type { VoiceConfigImportRequest } from "@/api/admin/voice-cost";
import {
	exportVoiceConfig,
	fetchVoiceConfig,
	fetchVoiceUsage,
	importVoiceConfig,
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
import StatCard from "@/components/ui/StatCard";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

function VoiceTokenCard({
	service,
	onTest,
	testLabel,
	TestIcon,
}: {
	service: "tts" | "asr";
	onTest: () => Promise<void>;
	testLabel: string;
	TestIcon: typeof Volume2;
}) {
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
			queryClient.invalidateQueries({ queryKey: ["admin", "voice", "config"] });
		},
		onError: (e: unknown) => {
			const err = e as { response?: { data?: { detail?: string } } };
			toast.error(err.response?.data?.detail || "保存失败");
		},
	});

	const importMutation = useMutation({
		mutationFn: (data: VoiceConfigImportRequest) =>
			importVoiceConfig(data).then((r) => r.data),
		onSuccess: () => {
			toast.success("配置已导入");
			queryClient.invalidateQueries({ queryKey: ["admin", "voice", "config"] });
			queryClient.invalidateQueries({ queryKey: ["admin", "voice", "usage"] });
		},
		onError: (e: unknown) => {
			const err = e as { response?: { data?: { detail?: string } } };
			toast.error(err.response?.data?.detail || "导入失败");
		},
	});

	const [appId, setAppId] = useState("");
	const [token, setToken] = useState("");
	const [testPending, setTestPending] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const initForm = (c: VoiceConfigResponse | undefined) => {
		if (c) {
			setAppId(c.app_id || "");
			setToken("");
		}
	};
	const isInit = useRef(false);
	if (!isInit.current && config && !isLoading) {
		initForm(config);
		isInit.current = true;
	}

	const handleSave = () => {
		if (!appId.trim()) {
			toast.warning("请输入 App ID");
			return;
		}
		saveMutation.mutate({
			app_id: appId.trim(),
			token: token || undefined,
			tts_voice_type: config?.tts_voice_type,
			asr_sample_rate: config?.asr_sample_rate,
			asr_enable_streaming: config?.asr_enable_streaming,
			monthly_budget: config?.monthly_budget,
		});
	};

	const handleTestClick = async () => {
		setTestPending(true);
		try {
			await onTest();
		} finally {
			setTestPending(false);
		}
	};

	const handleExport = async () => {
		try {
			const r = await exportVoiceConfig();
			const blob = new Blob([JSON.stringify(r.data, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `voice_config_${service}_${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("配置已导出");
		} catch {
			toast.error("导出失败");
		}
	};

	const handleImportFile = (e: { target: HTMLInputElement }) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			try {
				const data = JSON.parse(ev.target?.result as string);
				if (!data.app_id) {
					toast.error("无效的配置文件：缺少 app_id");
					return;
				}
				if (!data.token) {
					toast.error("导入文件不含 token，请手动输入后保存");
					setAppId(data.app_id || "");
					setToken("");
					return;
				}
				importMutation.mutate({
					app_id: data.app_id,
					token: data.token,
					provider: data.provider,
					tts_voice_type: data.tts_voice_type,
					tts_timeout: data.tts_timeout,
					asr_sample_rate: data.asr_sample_rate,
					asr_enable_streaming: data.asr_enable_streaming,
					monthly_budget: data.monthly_budget,
				});
			} catch {
				toast.error("无法解析配置文件");
			}
		};
		reader.readAsText(file);
		// reset so same file can be re-imported
		e.target.value = "";
	};

	if (isLoading) return <LoadingSkeleton />;

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>API 凭证</CardTitle>
				<div className="flex gap-1">
					<Button variant="outline" size="sm" onClick={handleExport}>
						<Download className="size-3.5" />
						导出
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload className="size-3.5" />
						导入
					</Button>
					<input
						ref={fileInputRef}
						type="file"
						accept=".json"
						className="hidden"
						onChange={handleImportFile}
					/>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{!config ? (
					<EmptyState
						title="无语音服务配置"
						description="请配置 Volcengine API 凭证"
					/>
				) : (
					<>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div className="space-y-1.5">
								<Label htmlFor={`${service}-app-id`}>App ID</Label>
								<Input
									id={`${service}-app-id`}
									value={appId}
									onChange={(e) => setAppId(e.target.value)}
									placeholder="Volcengine App ID"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor={`${service}-token`}>
									API Token{" "}
									<span className="text-muted-foreground text-xs">
										(当前: {config.token_masked || "未设置"})
									</span>
								</Label>
								<Input
									id={`${service}-token`}
									type="password"
									value={token}
									onChange={(e) => setToken(e.target.value)}
									placeholder="留空不修改"
								/>
							</div>
						</div>

						<div className="flex gap-2">
							<Button onClick={handleSave} disabled={saveMutation.isPending}>
								{saveMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Save className="size-4" />
								)}
								保存凭证
							</Button>
							<Button
								variant="outline"
								onClick={handleTestClick}
								disabled={testPending}
							>
								{testPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<TestIcon className="size-4" />
								)}
								{testLabel}
							</Button>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}

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
									<TableCell className="text-right tabular-nums text-red-500">
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
				service="tts"
				onTest={async () => {
					try {
						const r = await testTTS();
						if (r.data.tts_online) {
							toast.success("TTS 测试通过");
						} else {
							toast.error(r.data.last_error || "TTS 测试失败");
						}
					} catch (e: unknown) {
						const err = e as { response?: { data?: { detail?: string } } };
						toast.error(err.response?.data?.detail || "TTS 测试失败");
					}
				}}
				testLabel="测试 TTS"
				TestIcon={Volume2}
			/>

			<TTSUsageTable />
		</div>
	);
}
