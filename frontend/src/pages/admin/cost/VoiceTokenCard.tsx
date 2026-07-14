import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Loader2, Play, Save, Volume2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { Separator } from "@/components/ui/separator";

const TTS_RESOURCE_IDS = ["seed-tts-2.0", "seed-icl-2.0"];
const TTS_FORMATS = ["mp3", "wav", "pcm", "ogg_opus"];
const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000];

const selectClass =
	"flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const DEFAULT_FORM = {
	api_key: "",
	tts_resource_id: "seed-tts-2.0",
	tts_speaker: "zh_female_vv_uranus_bigtts",
	tts_format: "mp3",
	tts_sample_rate: 24000,
	tts_timeout: 8,
};

function formFromConfig(config: VoiceConfigResponse | undefined) {
	if (!config) return { ...DEFAULT_FORM };
	return {
		api_key: "",
		tts_resource_id: config.tts_resource_id || DEFAULT_FORM.tts_resource_id,
		tts_speaker: config.tts_speaker || DEFAULT_FORM.tts_speaker,
		tts_format: config.tts_format || DEFAULT_FORM.tts_format,
		tts_sample_rate: config.tts_sample_rate || DEFAULT_FORM.tts_sample_rate,
		tts_timeout: config.tts_timeout || DEFAULT_FORM.tts_timeout,
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
	const [ttsOnline, setTtsOnline] = useState<boolean | null>(null);
	const [checkingStatus, setCheckingStatus] = useState(false);
	const [synthPending, setSynthPending] = useState(false);
	const [testText, setTestText] = useState("你好，这是一段测试语音。");
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement>(null);

	useEffect(() => {
		if (!isLoading && config) setForm(formFromConfig(config));
	}, [config, isLoading]);

	useEffect(() => { checkStatus(); }, [config?.id]);
	useEffect(() => { if (audioUrl) audioRef.current?.play(); }, [audioUrl]);

	const checkStatus = () => {
		if (!config) return;
		setCheckingStatus(true);
		testTTS().then((r) => {
			setTtsOnline(r.data.tts_online);
		}).catch(() => {
			setTtsOnline(false);
		}).finally(() => setCheckingStatus(false));
	};

	const setField = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

	const handleSave = () => {
		saveMutation.mutate({
			provider: "volcengine",
			api_key: form.api_key || undefined,
			tts_resource_id: form.tts_resource_id,
			tts_speaker: form.tts_speaker,
			tts_format: form.tts_format,
			tts_sample_rate: form.tts_sample_rate,
			tts_timeout: form.tts_timeout,
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
			const url = URL.createObjectURL(blob);
			if (audioUrl) URL.revokeObjectURL(audioUrl);
			setAudioUrl(url);
		} catch (e: unknown) {
			toast.apiError(e, "语音生成失败");
		} finally {
			setSynthPending(false);
		}
	};

	if (isLoading) return <LoadingSkeleton />;

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle className="flex items-center gap-2">
					TTS 语音配置
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
			</CardHeader>
			<CardContent className="space-y-4">
				{!config && (
					<div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
						<p className="font-medium text-foreground text-sm">接入步骤</p>
						<ol className="list-decimal list-inside space-y-0.5">
							<li><a href="https://console.volcengine.com/speech/new/setting/apikeys" target="_blank" rel="noreferrer" className="text-primary underline">火山引擎控制台</a> 创建 API Key</li>
							<li><a href="https://console.volcengine.com/speech/new/voices" target="_blank" rel="noreferrer" className="text-primary underline">音色库</a> 选择音色 ID</li>
							<li>填写下方表单，保存后点"验证"</li>
						</ol>
					</div>
				)}

				<div className="space-y-1.5">
					<Label htmlFor="voice-api-key">
						API Key{" "}
						<span className="text-muted-foreground text-xs">(当前: {config?.api_key_masked || "未设置"})</span>
					</Label>
					<Input
						id="voice-api-key"
						type="password"
						value={form.api_key}
						onChange={(e) => setField({ api_key: e.target.value })}
						placeholder="从火山引擎控制台获取"
					/>
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="voice-tts-speaker">音色 ID</Label>
					<Input
						id="voice-tts-speaker"
						value={form.tts_speaker}
						onChange={(e) => setField({ tts_speaker: e.target.value })}
						placeholder="zh_female_vv_uranus_bigtts"
					/>
					<p className="text-[10px] text-muted-foreground">
						<a href="https://console.volcengine.com/speech/new/voices" target="_blank" rel="noreferrer" className="underline">音色库</a> 获取
					</p>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label htmlFor="voice-tts-resource">Resource ID</Label>
						<select
							id="voice-tts-resource"
							value={form.tts_resource_id}
							onChange={(e) => setField({ tts_resource_id: e.target.value })}
							className={selectClass}
						>
							{TTS_RESOURCE_IDS.map((m) => (<option key={m} value={m}>{m}</option>))}
						</select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="voice-tts-format">音频格式</Label>
						<select
							id="voice-tts-format"
							value={form.tts_format}
							onChange={(e) => setField({ tts_format: e.target.value })}
							className={selectClass}
						>
							{TTS_FORMATS.map((f) => (<option key={f} value={f}>{f}</option>))}
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
							{SAMPLE_RATES.map((r) => (<option key={r} value={r}>{r}</option>))}
						</select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="voice-tts-timeout">超时 (秒)</Label>
						<Input
							id="voice-tts-timeout"
							type="number" min={3} max={30}
							value={form.tts_timeout}
							onChange={(e) => setField({ tts_timeout: Number(e.target.value) })}
						/>
					</div>
				</div>

				<Button onClick={handleSave} disabled={saveMutation.isPending}>
					{saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
					保存配置
				</Button>

				<Separator />

				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<Volume2 size={16} className="text-muted-foreground" />
						<span className="text-sm font-medium">语音测试</span>
					</div>
					<textarea
						value={testText}
						onChange={(e) => setTestText(e.target.value)}
						placeholder="输入要合成的文本..."
						maxLength={200}
						rows={2}
						className="w-full p-2.5 rounded-md border border-border text-sm resize-y outline-none bg-card focus:border-primary"
					/>
					<Button variant="outline" onClick={handleSynthesize} disabled={synthPending || !testText.trim()}>
						{synthPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
						生成并播放
					</Button>
					{audioUrl && (
						<audio ref={audioRef} controls className="w-full h-8" src={audioUrl}>
							<track kind="captions" />
						</audio>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
