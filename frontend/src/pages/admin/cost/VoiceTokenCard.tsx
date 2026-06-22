import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Save, Upload } from "lucide-react";
import type { ElementType } from "react";
import { useEffect, useState } from "react";
import type { VoiceConfigImportRequest } from "@/api/admin/voice-cost";
import {
	exportVoiceConfig,
	fetchVoiceConfig,
	importVoiceConfig,
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
import Modal from "@/components/ui/Modal";
import { Separator } from "@/components/ui/separator";

const VOICE_TYPES = [
	"zh_female_vv",
	"zh_male_vv",
	"zh_female_qingxin",
	"zh_male_qingse",
	"zh_female_shuangkuai",
	"zh_male_yingjun",
];

const selectClass =
	"flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface VoiceTokenCardProps {
	onTest: () => Promise<void>;
	testLabel: string;
	TestIcon: ElementType;
}

function ImportModal({
	open,
	onClose,
	config,
}: {
	open: boolean;
	onClose: () => void;
	config: VoiceConfigResponse | undefined;
}) {
	const toast = useToast();
	const queryClient = useQueryClient();

	const [form, setForm] = useState({
		provider: "volcengine",
		app_id: "",
		token: "",
		tts_voice_type: "zh_female_vv",
		tts_timeout: 8,
		asr_sample_rate: 16000,
		asr_enable_streaming: true,
		monthly_budget: 200,
	});

	useEffect(() => {
		if (open && config) {
			setForm({
				provider: config.provider || "volcengine",
				app_id: config.app_id || "",
				token: "",
				tts_voice_type: config.tts_voice_type || "zh_female_vv",
				tts_timeout: config.tts_timeout || 8,
				asr_sample_rate: config.asr_sample_rate || 16000,
				asr_enable_streaming: config.asr_enable_streaming ?? true,
				monthly_budget: config.monthly_budget || 200,
			});
		}
	}, [open, config]);

	const importMutation = useMutation({
		mutationFn: (data: VoiceConfigImportRequest) =>
			importVoiceConfig(data).then((r) => r.data),
		onSuccess: () => {
			toast.success("配置已导入");
			queryClient.invalidateQueries({ queryKey: ["admin", "voice", "config"] });
			queryClient.invalidateQueries({ queryKey: ["admin", "voice", "usage"] });
			onClose();
		},
		onError: (e: unknown) => {
			const err = e as { response?: { data?: { detail?: string } } };
			toast.error(err.response?.data?.detail || "导入失败");
		},
	});

	const handleImport = () => {
		if (!form.app_id.trim()) {
			toast.warning("请输入 App ID");
			return;
		}
		if (!form.token.trim()) {
			toast.warning("请输入 API Token");
			return;
		}
		importMutation.mutate({
			provider: form.provider,
			app_id: form.app_id.trim(),
			token: form.token.trim(),
			tts_voice_type: form.tts_voice_type,
			tts_timeout: form.tts_timeout,
			asr_sample_rate: form.asr_sample_rate,
			asr_enable_streaming: form.asr_enable_streaming,
			monthly_budget: form.monthly_budget,
		});
	};

	const setField = (patch: Partial<typeof form>) =>
		setForm((f) => ({ ...f, ...patch }));

	return (
		<Modal open={open} onClose={onClose} title="导入语音服务配置" maxWidth={560}>
			<div className="space-y-4 py-2">
				<div className="text-sm text-muted-foreground">
					填写 Volcengine 语音服务配置，覆盖当前设置。导出文件可作为参考模板。
				</div>

				<Separator />

				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="import-provider">服务商</Label>
						<select
							id="import-provider"
							value={form.provider}
							onChange={(e) => setField({ provider: e.target.value })}
							className={selectClass}
						>
							<option value="volcengine">Volcengine (火山引擎)</option>
						</select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="import-monthly-budget">月度预算 (¥)</Label>
						<Input
							id="import-monthly-budget"
							type="number"
							min={0}
							step={1}
							value={form.monthly_budget}
							onChange={(e) =>
								setField({ monthly_budget: Number(e.target.value) })
							}
						/>
					</div>
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="import-app-id">App ID</Label>
					<Input
						id="import-app-id"
						value={form.app_id}
						onChange={(e) => setField({ app_id: e.target.value })}
						placeholder="Volcengine 应用 ID"
					/>
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="import-token">API Token</Label>
					<Input
						id="import-token"
						type="password"
						value={form.token}
						onChange={(e) => setField({ token: e.target.value })}
						placeholder="Volcengine Access Token"
					/>
				</div>

				<Separator />

				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="import-voice-type">TTS 语音类型</Label>
						<select
							id="import-voice-type"
							value={form.tts_voice_type}
							onChange={(e) => setField({ tts_voice_type: e.target.value })}
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
						<Label htmlFor="import-tts-timeout">TTS 超时 (秒)</Label>
						<Input
							id="import-tts-timeout"
							type="number"
							min={3}
							max={30}
							step={1}
							value={form.tts_timeout}
							onChange={(e) =>
								setField({ tts_timeout: Number(e.target.value) })
							}
						/>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="import-asr-rate">ASR 采样率</Label>
						<select
							id="import-asr-rate"
							value={form.asr_sample_rate}
							onChange={(e) =>
								setField({ asr_sample_rate: Number(e.target.value) })
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
					<div className="space-y-1.5 flex items-end">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={form.asr_enable_streaming}
								onChange={(e) =>
									setField({ asr_enable_streaming: e.target.checked })
								}
								className="size-4"
							/>
							启用流式 ASR
						</label>
					</div>
				</div>

				<div className="flex justify-end gap-2 pt-2">
					<Button variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button onClick={handleImport} disabled={importMutation.isPending}>
						{importMutation.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : null}
						确认导入
					</Button>
				</div>
			</div>
		</Modal>
	);
}

export default function VoiceTokenCard({
	onTest,
	testLabel,
	TestIcon,
}: VoiceTokenCardProps) {
	const toast = useToast();
	const queryClient = useQueryClient();
	const [importOpen, setImportOpen] = useState(false);

	const { data: config, isLoading } = useQuery({
		queryKey: ["admin", "voice", "config"],
		queryFn: () => fetchVoiceConfig().then((r) => r.data),
		staleTime: 60_000,
	});

	const saveMutation = useMutation({
		mutationFn: (data: Parameters<typeof updateVoiceConfig>[0]) =>
			updateVoiceConfig(data).then((r) => r.data),
		onSuccess: () => {
			toast.success("凭证已保存");
			queryClient.invalidateQueries({ queryKey: ["admin", "voice", "config"] });
		},
		onError: (e: unknown) => {
			const err = e as { response?: { data?: { detail?: string } } };
			toast.error(err.response?.data?.detail || "保存失败");
		},
	});

	const [appId, setAppId] = useState("");
	const [token, setToken] = useState("");
	const [testPending, setTestPending] = useState(false);

	const initForm = (c: VoiceConfigResponse | undefined) => {
		if (c) {
			setAppId(c.app_id || "");
			setToken("");
		}
	};

	useRefFlag(config, isLoading, initForm);

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
			a.download = `voice_config_${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("配置已导出");
		} catch {
			toast.error("导出失败");
		}
	};

	if (isLoading) return <LoadingSkeleton />;

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle>API 凭证</CardTitle>
					<div className="flex gap-1">
						<Button variant="outline" size="sm" onClick={handleExport}>
							<Download className="size-3.5" />
							导出
						</Button>
						<Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
							<Upload className="size-3.5" />
							导入
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{!config ? (
						<EmptyState
							title="无语音服务配置"
							description="请通过「导入」按钮配置 Volcengine API 凭证"
						/>
					) : (
						<>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-1.5">
									<Label htmlFor="voice-app-id">App ID</Label>
									<Input
										id="voice-app-id"
										value={appId}
										onChange={(e) => setAppId(e.target.value)}
										placeholder="Volcengine App ID"
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="voice-token">
										API Token{" "}
										<span className="text-muted-foreground text-xs">
											(当前: {config.token_masked || "未设置"})
										</span>
									</Label>
									<Input
										id="voice-token"
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

			<ImportModal
				open={importOpen}
				onClose={() => setImportOpen(false)}
				config={config}
			/>
		</>
	);
}

function useRefFlag<T>(
	value: T | undefined,
	loading: boolean,
	onFirst: (v: T | undefined) => void,
) {
	const [done, setDone] = useState(false);
	if (!done && value && !loading) {
		setDone(true);
		onFirst(value);
	}
}
