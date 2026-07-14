import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Download, Loader2, Play, Save, Volume2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	exportVoiceConfig,
	fetchVoiceConfig,
	testSynthesize,
	testTTS,
	updateVoiceConfig,
	type VoiceConfigResponse,
} from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { Separator } from "@/components/ui/separator";

const TTS_MODELS = ["seed-tts-2.0-standard"];
const TTS_RESOURCE_IDS = ["seed-tts-2.0", "seed-icl-2.0"];
const TTS_FORMATS = ["mp3", "wav", "pcm", "ogg_opus"];
const ASR_ENDPOINT_MODES = ["bigmodel_nostream", "bigmodel", "bigmodel_async"];
const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000];

const selectClass =
	"flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

const SPEAKER_SLOT_LABELS: Record<string, string> = {
	child_male: "男童 ≤12岁",
	child_female: "女童 ≤12岁",
	male_young: "男 13-25岁",
	male_middle: "男 26-59岁",
	male_elder: "男 ≥60岁",
	female_young: "女 13-25岁",
	female_middle: "女 26-59岁",
	female_elder: "女 ≥60岁",
	fallback: "未知性别/年龄",
};

const SPEAKER_SLOTS = Object.keys(SPEAKER_SLOT_LABELS);

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
		asr_endpoint_mode: config.asr_endpoint_mode || DEFAULT_FORM.asr_endpoint_mode,
		monthly_budget: config.monthly_budget || DEFAULT_FORM.monthly_budget,
	};
}

export default function VoiceTokenCard() {
	const toast = useToast();
	const queryClient = useQueryClient();
	const { data: config, isLoading } = useQuery({
		queryKey: queryKeys.voice.config,
		queryFn: () => fetchVoiceConfig().then((r) => r.data),
		staleTime: 60_000,
	});

	const saveMutation = useMutation({
		mutationFn: (data: Parameters<typeof updateVoiceConfig>[0]) =>
			updateVoiceConfig(data).then((r) => r.data),
		onSuccess: () => {
			toast.success("配置已保存");
			queryClient.invalidateQueries({ queryKey: queryKeys.voice.config });
		},
		onError: (e: unknown) => {
			toast.apiError(e, "保存失败");
		},
	});

	const [form, setForm] = useState({ ...DEFAULT_FORM });
	const [speakerLibrary, setSpeakerLibrary] = useState<Record<string, string>>({});
	const [ttsOnline, setTtsOnline] = useState<boolean | null>(null);
	const [checkingStatus, setCheckingStatus] = useState(false);
	const [synthPending, setSynthPending] = useState(false);
	const [testText, setTestText] = useState("你好，这是一段测试语音。");
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement>(null);

	useEffect(() => {
		if (!isLoading && config) {
			setForm(formFromConfig(config));
			setSpeakerLibrary(config.speaker_library || {});
		}
	}, [config, isLoading]);

	// 页面加载后自动检测 TTS 服务状态
	useEffect(() => {
		checkStatus();
	}, [config?.id]);

	const checkStatus = () => {
		if (!config) return;
		setCheckingStatus(true);
		testTTS().then((r) => {
			setTtsOnline(r.data.tts_online);
		}).catch(() => {
			setTtsOnline(false);
		}).finally(() => setCheckingStatus(false));
	};

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
			speaker_library: Object.keys(speakerLibrary).length > 0 ? speakerLibrary : undefined,
		});
	};

	const handleSynthesize = async () => {
		if (!testText.trim()) return;
		setSynthPending(true);
		try {
			const res = await testSynthesize(testText.trim());
			const arr = res.data as unknown as ArrayBuffer;
			const ct = (res.headers as Record<string, string>)?.["content-type"] || "audio/mpeg";
			const blob = new Blob([arr], { type: ct });
			if (audioUrl) URL.revokeObjectURL(audioUrl);
			setAudioUrl(URL.createObjectURL(blob));
			toast.success("语音生成成功");
		} catch (e: unknown) {
			toast.apiError(e, "语音生成失败");
		} finally {
			setSynthPending(false);
		}
	};

	const handleDownload = () => {
		if (!audioUrl) return;
		const a = document.createElement("a");
		a.href = audioUrl;
		a.download = `tts_test.${form.tts_format}`;
		a.click();
	};

	const handleExport = async () => {
		try {
			const r = await exportVoiceConfig();
			const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
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
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle className="flex items-center gap-2">
					API 凭证与参数
					{checkingStatus ? (
						<Loader2 size={14} className="animate-spin text-muted-foreground" />
					) : ttsOnline !== null ? (
						ttsOnline ? (
							<span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-normal">
								<CheckCircle size={13} /> 在线
							</span>
						) : (
							<span className="inline-flex items-center gap-1 text-[11px] text-danger font-normal">
								<XCircle size={13} /> 离线
							</span>
						)
					) : null}
					<Button variant="ghost" size="sm" onClick={checkStatus} disabled={checkingStatus} className="h-6 px-1.5 text-[10px]">
						{checkingStatus ? <Loader2 size={12} className="animate-spin" /> : "验证"}
					</Button>
				</CardTitle>
				<Button variant="outline" size="sm" onClick={handleExport}>
					<Download className="size-3.5" />
					导出配置
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				{!config && (
					<div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
						<p className="font-medium text-foreground text-sm">接入步骤</p>
						<ol className="list-decimal list-inside space-y-1">
							<li>前往 <a href="https://console.volcengine.com/speech/new/setting/apikeys" target="_blank" rel="noreferrer" className="text-primary underline">火山引擎控制台 → API Key 管理</a> 创建 API Key</li>
							<li>前往 <a href="https://console.volcengine.com/speech/new/voices" target="_blank" rel="noreferrer" className="text-primary underline">音色库</a> 选择需要的音色 ID</li>
							<li>填写下方表单并保存</li>
						</ol>
					</div>
				)}
						<div className="space-y-1.5">
							<Label htmlFor="voice-api-key">
								API Key{" "}
								<span className="text-muted-foreground text-xs">
									(当前: {config?.api_key_masked || "未设置"})
								</span>
							</Label>
							<Input
								id="voice-api-key"
								type="password"
								value={form.api_key}
								onChange={(e) => setField({ api_key: e.target.value })}
								placeholder="从 火山引擎控制台 → API Key 管理 获取"
							/>
						</div>

						<Separator />

						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div className="space-y-1.5">
								<Label htmlFor="voice-tts-speaker">TTS 音色 ID</Label>
								<Input
									id="voice-tts-speaker"
									value={form.tts_speaker}
									onChange={(e) => setField({ tts_speaker: e.target.value })}
									placeholder="zh_female_vv_uranus_bigtts"
								/>
								<p className="text-[10px] text-muted-foreground">
									<a href="https://console.volcengine.com/speech/new/voices" target="_blank" rel="noreferrer" className="underline">音色库</a> 获取 ID，或使用 Speaker Library 按人口匹配
								</p>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="voice-tts-resource">TTS Resource ID</Label>
								<select
									id="voice-tts-resource"
									value={form.tts_resource_id}
									onChange={(e) => setField({ tts_resource_id: e.target.value })}
									className={selectClass}
								>
									{TTS_RESOURCE_IDS.map((m) => (
										<option key={m} value={m}>{m}</option>
									))}
								</select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="voice-tts-model">TTS 模型版本</Label>
								<select
									id="voice-tts-model"
									value={form.tts_model}
									onChange={(e) => setField({ tts_model: e.target.value })}
									className={selectClass}
								>
									{TTS_MODELS.map((m) => (
										<option key={m} value={m}>{m}</option>
									))}
								</select>
							</div>
							<div className="grid grid-cols-2 gap-2">
								<div className="space-y-1.5">
									<Label htmlFor="voice-tts-timeout">超时 (秒)</Label>
									<Input
										id="voice-tts-timeout"
										type="number"
										min={3} max={30}
										value={form.tts_timeout}
										onChange={(e) => setField({ tts_timeout: Number(e.target.value) })}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="voice-monthly-budget">月度预算 (¥)</Label>
									<Input
										id="voice-monthly-budget"
										type="number"
										min={1}
										value={form.monthly_budget}
										onChange={(e) => setField({ monthly_budget: Number(e.target.value) })}
									/>
								</div>
							</div>
							<div className="grid grid-cols-2 gap-2">
								<div className="space-y-1.5">
									<Label htmlFor="voice-tts-format">格式</Label>
									<select
										id="voice-tts-format"
										value={form.tts_format}
										onChange={(e) => setField({ tts_format: e.target.value })}
										className={selectClass}
									>
										{TTS_FORMATS.map((f) => (
											<option key={f} value={f}>{f}</option>
										))}
									</select>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="voice-tts-rate">采样率 (Hz)</Label>
									<select
										id="voice-tts-rate"
										value={form.tts_sample_rate}
										onChange={(e) => setField({ tts_sample_rate: Number(e.target.value) })}
										className={selectClass}
									>
										{SAMPLE_RATES.map((r) => (
											<option key={r} value={r}>{r}</option>
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
									onChange={(e) => setField({ asr_resource_id: e.target.value })}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="voice-asr-mode">ASR 接入模式</Label>
								<select
									id="voice-asr-mode"
									value={form.asr_endpoint_mode}
									onChange={(e) => setField({ asr_endpoint_mode: e.target.value })}
									className={selectClass}
								>
									{ASR_ENDPOINT_MODES.map((m) => (
										<option key={m} value={m}>{m}</option>
									))}
								</select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="voice-asr-rate">ASR 采样率 (Hz)</Label>
								<select
									id="voice-asr-rate"
									value={form.asr_sample_rate}
									onChange={(e) => setField({ asr_sample_rate: Number(e.target.value) })}
									className={selectClass}
								>
									{SAMPLE_RATES.map((r) => (
										<option key={r} value={r}>{r}</option>
									))}
								</select>
							</div>
						</div>

						<Separator />

						<div className="space-y-3">
							<div className="text-sm font-medium text-muted-foreground">Speaker Library（人口 → 音色 ID 映射）</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
								{SPEAKER_SLOTS.map((slot) => (
									<div key={slot} className="space-y-1">
										<Label className="text-xs">{SPEAKER_SLOT_LABELS[slot]}</Label>
										<Input
											value={speakerLibrary[slot] || ""}
											onChange={(e) => setSpeakerLibrary((prev) => ({ ...prev, [slot]: e.target.value }))}
											placeholder={DEFAULT_FORM.tts_speaker}
											className="text-xs h-8"
										/>
									</div>
								))}
							</div>
							{Object.keys(speakerLibrary).length > 0 && (
								<button
									type="button"
									onClick={() => setSpeakerLibrary({})}
									className="text-xs text-muted-foreground hover:text-foreground underline"
								>
									重置为默认
								</button>
							)}
						</div>

						<Separator />

						<div className="flex gap-2">
							<Button onClick={handleSave} disabled={saveMutation.isPending}>
								{saveMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Save className="size-4" />
								)}
								保存配置
							</Button>
						</div>

						<Separator />

						<div className="space-y-3">
							<div className="flex items-center gap-2">
								<Volume2 size={16} className="text-muted-foreground" />
								<span className="text-sm font-medium">语音测试生成</span>
								<span className="text-[10px] text-muted-foreground">
									双向 WS · {form.tts_speaker} · {form.tts_format}@{form.tts_sample_rate}Hz
								</span>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="voice-test-text">测试文本（最长 200 字）</Label>
								<textarea
									id="voice-test-text"
									value={testText}
									onChange={(e) => setTestText(e.target.value)}
									placeholder="输入要合成的文本..."
									maxLength={200}
									rows={3}
									className="w-full p-2.5 rounded-md border border-border text-sm resize-y outline-none bg-card focus:border-primary"
								/>
							</div>
							<div className="flex gap-2">
								<Button
									variant="outline"
									onClick={handleSynthesize}
									disabled={synthPending || !testText.trim()}
								>
									{synthPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Play className="size-4" />
									)}
									生成语音
								</Button>
								{audioUrl && (
									<Button variant="ghost" onClick={handleDownload}>
										<Download className="size-4" />
										下载 {form.tts_format}
									</Button>
								)}
							</div>
							{audioUrl && (
								<div className="rounded-lg border border-border bg-muted/20 p-3">
									<audio ref={audioRef} controls className="w-full h-8" src={audioUrl}>
										<track kind="captions" />
									</audio>
								</div>
							)}
						</div>
				</CardContent>
		</Card>
	);
}
