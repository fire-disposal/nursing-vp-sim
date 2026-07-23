import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Loader2,
	Play,
	Save,
	Square,
	Volume2,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	fetchVoiceConfig,
	fetchVoiceUsage,
	streamTestTTS,
	testTTS,
	updateVoiceConfig,
	type VoiceConfigResponse,
	type VoiceStatusResponse,
} from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { Separator } from "@/components/ui/separator";
import { PcmStreamPlayer } from "@/engine/tts/pcm-player";

const TTS_RESOURCE_IDS = ["seed-tts-2.0", "seed-icl-2.0"];

const selectClass =
	"flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const DEFAULT_FORM = {
	api_key: "",
	tts_resource_id: "seed-tts-2.0",
	tts_speaker: "zh_female_vv_uranus_bigtts",
	tts_timeout: 8,
};

function formFromConfig(config: VoiceConfigResponse | undefined) {
	if (!config) return { ...DEFAULT_FORM };
	return {
		api_key: "",
		tts_resource_id: config.tts_resource_id || DEFAULT_FORM.tts_resource_id,
		tts_speaker: config.tts_speaker || DEFAULT_FORM.tts_speaker,
		tts_timeout: config.tts_timeout || DEFAULT_FORM.tts_timeout,
	};
}

function StatusStrip({
	status,
	checking,
	onVerify,
}: {
	status: VoiceStatusResponse | null;
	checking: boolean;
	onVerify: () => void;
}) {
	const { data: usage } = useQuery({
		queryKey: queryKeys.voice.usage,
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});
	const today = usage?.tts_today;
	const successRate =
		today && today.calls_total > 0
			? `${((today.calls_success / today.calls_total) * 100).toFixed(1)}%`
			: null;

	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
			{checking ? (
				<span className="inline-flex items-center gap-1 text-muted-foreground">
					<Loader2 size={13} className="animate-spin" /> 验证中…
				</span>
			) : status ? (
				status.tts_online ? (
					<span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
						<CheckCircle size={13} /> 在线
					</span>
				) : (
					<span className="inline-flex items-center gap-1 text-danger font-medium">
						<XCircle size={13} /> 离线
					</span>
				)
			) : (
				<span className="text-muted-foreground">状态未知</span>
			)}

			{status?.tts_pool_total != null && (
				<span className="inline-flex items-center gap-1 text-muted-foreground">
					<Activity size={12} />
					连接池 {status.tts_pool_in_use ?? 0} 在用 / {status.tts_pool_total} 已建 /{" "}
					{status.tts_pool_size ?? "-"} 上限
				</span>
			)}

			{successRate !== null && (
				<span className="text-muted-foreground">
					今日成功率 <span className="text-foreground font-medium">{successRate}</span>（
					{today?.calls_total ?? 0} 次）
				</span>
			)}

			<Button
				variant="ghost"
				size="sm"
				onClick={onVerify}
				disabled={checking}
				className="h-6 px-1.5 text-[11px] ml-auto"
			>
				验证
			</Button>

			{status?.last_error && (
				<div className="w-full text-[11px] text-danger/90 break-all">
					{status.last_error}
				</div>
			)}
		</div>
	);
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
	const [status, setStatus] = useState<VoiceStatusResponse | null>(null);
	const [checkingStatus, setCheckingStatus] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [testText, setTestText] = useState("你好，这是一段测试语音。");
	const [playPending, setPlayPending] = useState(false);
	const [firstChunkMs, setFirstChunkMs] = useState<number | null>(null);
	const playerRef = useRef<PcmStreamPlayer | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		if (!isLoading && config) setForm(formFromConfig(config));
	}, [config, isLoading]);

	useEffect(() => {
		if (!config) return;
		checkStatus();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [config?.id]);

	useEffect(() => () => stopPlayback(), []);

	const checkStatus = () => {
		if (!config) return;
		setCheckingStatus(true);
		testTTS()
			.then((r) => setStatus(r.data))
			.catch(() => setStatus(null))
			.finally(() => setCheckingStatus(false));
	};

	const setField = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

	const handleSave = () => {
		saveMutation.mutate({
			provider: "volcengine",
			api_key: form.api_key || undefined,
			tts_resource_id: form.tts_resource_id,
			tts_speaker: form.tts_speaker,
			tts_timeout: form.tts_timeout,
		});
	};

	const stopPlayback = () => {
		abortRef.current?.abort();
		abortRef.current = null;
		playerRef.current?.stop();
		setPlayPending(false);
	};

	const handleStreamPlay = async () => {
		const text = testText.trim();
		if (!text || playPending) return;
		stopPlayback();
		setPlayPending(true);
		setFirstChunkMs(null);
		const t0 = performance.now();
		try {
			if (!playerRef.current) playerRef.current = new PcmStreamPlayer();
			const abort = new AbortController();
			abortRef.current = abort;
			const stream = await streamTestTTS(text, abort.signal);
			await playerRef.current.playStream(stream, () => {
				setFirstChunkMs(Math.round(performance.now() - t0));
			});
		} catch (e: unknown) {
			if (!abortRef.current?.signal.aborted) {
				toast.apiError(e, "流式播放失败");
			}
		} finally {
			if (!abortRef.current?.signal.aborted) {
				setPlayPending(false);
			}
			abortRef.current = null;
		}
	};

	if (isLoading) return <LoadingSkeleton />;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					TTS 语音服务
					<span className="text-[11px] font-normal text-muted-foreground">
						豆包语音合成 2.0 · 流式（PCM 24kHz）
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<StatusStrip status={status} checking={checkingStatus} onVerify={checkStatus} />

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

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

				<button
					type="button"
					onClick={() => setShowAdvanced((v) => !v)}
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>
					{showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					高级
				</button>
				{showAdvanced && (
					<div className="space-y-1.5 max-w-xs">
						<Label htmlFor="voice-tts-resource">Resource ID</Label>
						<select
							id="voice-tts-resource"
							value={form.tts_resource_id}
							onChange={(e) => setField({ tts_resource_id: e.target.value })}
							className={selectClass}
						>
							{TTS_RESOURCE_IDS.map((m) => (<option key={m} value={m}>{m}</option>))}
						</select>
						<p className="text-[10px] text-muted-foreground">
							seed-tts-2.0 = 标准合成；seed-icl-2.0 = 声音复刻。音频格式/采样率由流式管线固定为 PCM 24kHz，无需配置。
						</p>
					</div>
				)}

				<Button onClick={handleSave} disabled={saveMutation.isPending}>
					{saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
					保存配置
				</Button>

				<Separator />

				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<Volume2 size={16} className="text-muted-foreground" />
						<span className="text-sm font-medium">试听（生产路径）</span>
						{firstChunkMs !== null && (
							<span className="text-[11px] text-muted-foreground">
								首块延迟 <span className="text-foreground font-medium">{firstChunkMs}ms</span>
							</span>
						)}
					</div>
					<textarea
						value={testText}
						onChange={(e) => setTestText(e.target.value)}
						placeholder="输入要合成的文本..."
						maxLength={200}
						rows={2}
						className="w-full p-2.5 rounded-md border border-border text-sm resize-y outline-none bg-card focus:border-primary"
					/>
					<div className="flex gap-2">
						<Button variant="outline" onClick={handleStreamPlay} disabled={playPending || !testText.trim()}>
							{playPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
							流式播放
						</Button>
						{playPending && (
							<Button variant="ghost" onClick={stopPlayback}>
								<Square className="size-4" /> 停止
							</Button>
						)}
					</div>
					<p className="text-[10px] text-muted-foreground">
						与训练页完全相同的链路：连接池 → 豆包 2.0 流式合成 → Web Audio 边收边播。
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
