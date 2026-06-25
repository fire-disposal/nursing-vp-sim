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
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { Separator } from "@/components/ui/separator";

const TTS_MODELS = ["seed-tts-2.0-standard", "seed-tts-2.0-expressive"];
const TTS_FORMATS = ["mp3", "wav", "pcm", "ogg_opus"];
const ASR_ENDPOINT_MODES = ["bigmodel_nostream", "bigmodel", "bigmodel_async"];
const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000];

const selectClass =
	"flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface VoiceTokenCardProps {
	onTest: () => Promise<void>;
	testLabel: string;
	TestIcon: ElementType;
}

const DEFAULT_FORM = {
	provider: "volcengine",
	api_key: "",
	tts_resource_id: "seed-tts-2.0",
	tts_speaker: "zh_female_vv_uranus_bigtts",
	tts_model: "seed-tts-2.0-standard",
	tts_sample_rate: 24000,
	tts_format: "mp3",
	tts_timeout: 8,
	asr_resource_id: "volc.bigasr.sauc.duration",
	asr_sample_rate: 16000,
	asr_endpoint_mode: "bigmodel_nostream",
	monthly_budget: 200,
};

function formFromConfig(config: VoiceConfigResponse | undefined) {
	if (!config) return { ...DEFAULT_FORM };
	return {
		provider: config.provider || "volcengine",
		api_key: "",
		tts_resource_id: config.tts_resource_id || DEFAULT_FORM.tts_resource_id,
		tts_speaker: config.tts_speaker || DEFAULT_FORM.tts_speaker,
		tts_model: config.tts_model || DEFAULT_FORM.tts_model,
		tts_sample_rate: config.tts_sample_rate || DEFAULT_FORM.tts_sample_rate,
		tts_format: config.tts_format || DEFAULT_FORM.tts_format,
		tts_timeout: config.tts_timeout || DEFAULT_FORM.tts_timeout,
		asr_resource_id: config.asr_resource_id || DEFAULT_FORM.asr_resource_id,
		asr_sample_rate: config.asr_sample_rate || DEFAULT_FORM.asr_sample_rate,
		asr_endpoint_mode:
			config.asr_endpoint_mode || DEFAULT_FORM.asr_endpoint_mode,
		monthly_budget: config.monthly_budget || DEFAULT_FORM.monthly_budget,
	};
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
	const [form, setForm] = useState({ ...DEFAULT_FORM });

	useEffect(() => {
		if (open) setForm(formFromConfig(config));
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
			toast.apiError(e, "导入失败");
		},
	});

	const handleImport = () => {
		if (!form.api_key.trim()) {
			toast.warning("请输入 API Key");
			return;
		}
		importMutation.mutate({ ...form, api_key: form.api_key.trim() });
	};

	const setField = (patch: Partial<typeof form>) =>
		setForm((f) => ({ ...f, ...patch }));

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent title="导入语音服务配置" maxWidth={560}>
			<div className="space-y-4 py-2">
				<div className="text-sm text-muted-foreground">
					填写火山引擎语音服务配置，覆盖当前设置。
				</div>
				<Separator />

				<div className="space-y-1.5">
					<Label htmlFor="import-api-key">API Key</Label>
					<Input
						id="import-api-key"
						type="password"
						value={form.api_key}
						onChange={(e) => setField({ api_key: e.target.value })}
						placeholder="火山引擎控制台 API Key"
					/>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="import-tts-speaker">TTS 音色 (speaker)</Label>
						<Input
							id="import-tts-speaker"
							value={form.tts_speaker}
							onChange={(e) => setField({ tts_speaker: e.target.value })}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="import-tts-resource">TTS Resource ID</Label>
						<Input
							id="import-tts-resource"
							value={form.tts_resource_id}
							onChange={(e) => setField({ tts_resource_id: e.target.value })}
						/>
					</div>
				</div>

				<div className="grid grid-cols-3 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="import-tts-model">TTS 模型</Label>
						<select
							id="import-tts-model"
							value={form.tts_model}
							onChange={(e) => setField({ tts_model: e.target.value })}
							className={selectClass}
						>
							{TTS_MODELS.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="import-tts-format">TTS 格式</Label>
						<select
							id="import-tts-format"
							value={form.tts_format}
							onChange={(e) => setField({ tts_format: e.target.value })}
							className={selectClass}
						>
							{TTS_FORMATS.map((f) => (
								<option key={f} value={f}>
									{f}
								</option>
							))}
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

				<Separator />

				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="import-asr-resource">ASR Resource ID</Label>
						<Input
							id="import-asr-resource"
							value={form.asr_resource_id}
							onChange={(e) => setField({ asr_resource_id: e.target.value })}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="import-asr-mode">ASR 接入模式</Label>
						<select
							id="import-asr-mode"
							value={form.asr_endpoint_mode}
							onChange={(e) => setField({ asr_endpoint_mode: e.target.value })}
							className={selectClass}
						>
							{ASR_ENDPOINT_MODES.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</select>
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
			</DialogContent>
		</Dialog>
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
			toast.success("配置已保存");
			queryClient.invalidateQueries({ queryKey: ["admin", "voice", "config"] });
		},
		onError: (e: unknown) => {
			toast.apiError(e, "保存失败");
		},
	});

	const [form, setForm] = useState({ ...DEFAULT_FORM });
	const [testPending, setTestPending] = useState(false);

	useEffect(() => {
		if (!isLoading && config) setForm(formFromConfig(config));
	}, [config, isLoading]);

	const setField = (patch: Partial<typeof form>) =>
		setForm((f) => ({ ...f, ...patch }));

	const handleSave = () => {
		saveMutation.mutate({
			provider: form.provider,
			api_key: form.api_key || undefined,
			tts_resource_id: form.tts_resource_id,
			tts_speaker: form.tts_speaker,
			tts_model: form.tts_model,
			tts_sample_rate: form.tts_sample_rate,
			tts_format: form.tts_format,
			tts_timeout: form.tts_timeout,
			asr_resource_id: form.asr_resource_id,
			asr_sample_rate: form.asr_sample_rate,
			asr_endpoint_mode: form.asr_endpoint_mode,
			monthly_budget: form.monthly_budget,
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
					<CardTitle>API 凭证与参数</CardTitle>
					<div className="flex gap-1">
						<Button variant="outline" size="sm" onClick={handleExport}>
							<Download className="size-3.5" />
							导出
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setImportOpen(true)}
						>
							<Upload className="size-3.5" />
							导入
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{!config ? (
						<EmptyState
							title="无语音服务配置"
							description="请通过「导入」按钮配置火山引擎 API Key"
						/>
					) : (
						<>
							<div className="space-y-1.5">
								<Label htmlFor="voice-api-key">
									API Key{" "}
									<span className="text-muted-foreground text-xs">
										(当前: {config.api_key_masked || "未设置"})
									</span>
								</Label>
								<Input
									id="voice-api-key"
									type="password"
									value={form.api_key}
									onChange={(e) => setField({ api_key: e.target.value })}
									placeholder="留空不修改"
								/>
							</div>

							<Separator />

							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="space-y-1.5">
									<Label htmlFor="voice-tts-speaker">TTS 音色 (speaker)</Label>
									<Input
										id="voice-tts-speaker"
										value={form.tts_speaker}
										onChange={(e) => setField({ tts_speaker: e.target.value })}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="voice-tts-resource">TTS Resource ID</Label>
									<Input
										id="voice-tts-resource"
										value={form.tts_resource_id}
										onChange={(e) =>
											setField({ tts_resource_id: e.target.value })
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="voice-tts-model">TTS 模型</Label>
									<select
										id="voice-tts-model"
										value={form.tts_model}
										onChange={(e) => setField({ tts_model: e.target.value })}
										className={selectClass}
									>
										{TTS_MODELS.map((m) => (
											<option key={m} value={m}>
												{m}
											</option>
										))}
									</select>
								</div>
								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1.5">
										<Label htmlFor="voice-tts-format">TTS 格式</Label>
										<select
											id="voice-tts-format"
											value={form.tts_format}
											onChange={(e) => setField({ tts_format: e.target.value })}
											className={selectClass}
										>
											{TTS_FORMATS.map((f) => (
												<option key={f} value={f}>
													{f}
												</option>
											))}
										</select>
									</div>
									<div className="space-y-1.5">
										<Label htmlFor="voice-tts-rate">TTS 采样率</Label>
										<select
											id="voice-tts-rate"
											value={form.tts_sample_rate}
											onChange={(e) =>
												setField({ tts_sample_rate: Number(e.target.value) })
											}
											className={selectClass}
										>
											{SAMPLE_RATES.map((r) => (
												<option key={r} value={r}>
													{r}
												</option>
											))}
										</select>
									</div>
								</div>
							</div>

							<Separator />

							<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
								<div className="space-y-1.5">
									<Label htmlFor="voice-asr-resource">ASR Resource ID</Label>
									<Input
										id="voice-asr-resource"
										value={form.asr_resource_id}
										onChange={(e) =>
											setField({ asr_resource_id: e.target.value })
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="voice-asr-mode">ASR 接入模式</Label>
									<select
										id="voice-asr-mode"
										value={form.asr_endpoint_mode}
										onChange={(e) =>
											setField({ asr_endpoint_mode: e.target.value })
										}
										className={selectClass}
									>
										{ASR_ENDPOINT_MODES.map((m) => (
											<option key={m} value={m}>
												{m}
											</option>
										))}
									</select>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="voice-asr-rate">ASR 采样率</Label>
									<select
										id="voice-asr-rate"
										value={form.asr_sample_rate}
										onChange={(e) =>
											setField({ asr_sample_rate: Number(e.target.value) })
										}
										className={selectClass}
									>
										{SAMPLE_RATES.map((r) => (
											<option key={r} value={r}>
												{r}
											</option>
										))}
									</select>
								</div>
							</div>

							<div className="flex gap-2">
								<Button onClick={handleSave} disabled={saveMutation.isPending}>
									{saveMutation.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Save className="size-4" />
									)}
									保存配置
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
