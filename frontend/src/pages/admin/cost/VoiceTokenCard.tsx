import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Play, Save, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	fetchVoiceConfig,
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
import { Separator } from "@/components/ui/separator";
import { PcmStreamPlayer } from "@/engine/tts/pcm-player";

const TTS_RESOURCE_IDS = ["seed-tts-2.0", "seed-icl-2.0"];

const rowClass = "flex items-center gap-3 py-2";

const fieldLabelClass = "w-[88px] shrink-0 text-xs text-muted-foreground";

const inputClass =
	"h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const selectClass =
	"h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

const STATUS_DOT: Record<string, string> = {
	online: "bg-green-500",
	offline: "bg-red-500",
	checking: "bg-amber-400",
	unknown: "bg-gray-300",
};

function classifyError(e: string | null): string | undefined {
	if (!e) return undefined;
	const lower = e.toLowerCase();
	if (lower.includes("401") || lower.includes("unauthorized")) return "X-Api-Key (v3) 无效或已过期";
	if (lower.includes("403") || lower.includes("forbidden")) return "无权限 — 确认已开通「语音合成大模型 2.0」服务";
	if (lower.includes("timeout") || lower.includes("超时")) return "连接超时 — 检查网络或稍后重试";
	if (lower.includes("connect") || lower.includes("dns") || lower.includes("resolve")) return "网络不可达 — 服务端能否访问 openspeech.bytedance.com？";
	return e.length > 120 ? `${e.slice(0, 120)}…` : e;
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
			checkStatus();
		},
		onError: (e: unknown) => {
			toast.apiError(e, "保存失败");
		},
	});

	const [form, setForm] = useState({ ...DEFAULT_FORM });
	const [status, setStatus] = useState<VoiceStatusResponse | null>(null);
	const [checking, setChecking] = useState(false);
	const [_dirty, setDirty] = useState(false);
	const [showKey, setShowKey] = useState(false);

	const [testText, setTestText] = useState("你好，这是一段测试语音。");
	const [playPending, setPlayPending] = useState(false);
	const [firstChunkMs, setFirstChunkMs] = useState<number | null>(null);
	const [streamError, setStreamError] = useState<string | null>(null);
	const playerRef = useRef<PcmStreamPlayer | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const statusDot = checking
		? "checking"
		: status
			? status.tts_online
				? "online"
				: "offline"
			: "unknown";

	const errorHint = classifyError(status?.last_error ?? null);

	useEffect(() => {
		if (!isLoading && config) setForm(formFromConfig(config));
	}, [config, isLoading]);

	useEffect(() => {
		if (!config) return;
		checkStatus();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [config?.id]);

	useEffect(() => () => stopPlayback(), []);

	const checkStatus = useCallback(() => {
		if (!config) return;
		setChecking(true);
		testTTS()
			.then((r) => setStatus(r.data))
			.catch(() => setStatus(null))
			.finally(() => setChecking(false));
	}, [config]);

	const handleSave = useCallback(() => {
		saveMutation.mutate({
			provider: "volcengine",
			api_key: form.api_key || undefined,
			tts_resource_id: form.tts_resource_id,
			tts_speaker: form.tts_speaker,
			tts_timeout: form.tts_timeout,
		});
	}, [saveMutation, form]);

	const stopPlayback = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		playerRef.current?.stop();
		setPlayPending(false);
	}, []);

	const handleStreamPlay = useCallback(async () => {
		const text = testText.trim();
		if (!text || playPending) return;
		stopPlayback();
		setPlayPending(true);
		setFirstChunkMs(null);
		setStreamError(null);
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
				const msg = e instanceof Error ? e.message : String(e);
				setStreamError(msg);
			}
		} finally {
			if (!abortRef.current?.signal.aborted) {
				setPlayPending(false);
			}
			abortRef.current = null;
		}
	}, [testText, playPending, stopPlayback]);

	const setField = useCallback(
		(patch: Partial<typeof form>) => {
			setForm((f) => ({ ...f, ...patch }));
			setDirty(true);
		},
		[],
	);

	if (isLoading) return null;

	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center gap-2">
					<CardTitle className="flex items-center gap-2 text-base">TTS 语音服务</CardTitle>
					<span className="text-[11px] text-muted-foreground">豆包语音合成 2.0 · PCM 24kHz 流式</span>
				</div>
			</CardHeader>

			<CardContent className="space-y-4">
				{/* ── Status strip ── */}
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/20 px-3 py-1.5 text-xs">
					<div className="flex items-center gap-1.5">
						<span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[statusDot]}`} />
						<span className="font-medium text-foreground">
							{statusDot === "checking"
								? "检查中…"
								: status?.tts_online
									? "在线"
									: status
										? "离线"
										: "状态未知"}
						</span>
						<button
							type="button"
							onClick={checkStatus}
							disabled={checking}
							className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
						>
							刷新
						</button>
					</div>
					{status?.tts_pool_total != null && (
						<span className="text-muted-foreground/80">
							连接池 {status.tts_pool_in_use ?? 0}/{status.tts_pool_total}（上限 {status.tts_pool_size ?? "-"}）
						</span>
					)}
					{errorHint && (
						<span className="w-full text-[11px] text-danger/90">
							{errorHint}{" "}
							{!status?.tts_online && (
								<a
									href="https://console.volcengine.com/speech/new/setting/apikeys"
									target="_blank"
									rel="noreferrer"
									className="underline"
								>
									火山引擎 API Key 管理
								</a>
							)}
						</span>
					)}
				</div>

				{/* ── Form ── */}
				<div className="border border-border rounded-lg overflow-hidden text-sm">
					<div className={rowClass}>
						<span className={fieldLabelClass}>
							X-Api-Key
							<span className="text-[10px] text-muted-foreground/70 ml-0.5">v3</span>
						</span>
						<div className="flex-1 relative">
							<input
								type={showKey ? "text" : "password"}
								value={form.api_key}
								onChange={(e) => setField({ api_key: e.target.value })}
								placeholder={config?.api_key_masked || "从火山引擎控制台 → API Key 创建"}
								className={`${inputClass} pr-8`}
							/>
							<button
								type="button"
								onClick={() => setShowKey((v) => !v)}
								className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
							>
								{showKey ? <EyeOff size={14} /> : <Eye size={14} />}
							</button>
						</div>
						<a
							href="https://console.volcengine.com/speech/new/setting/apikeys"
							target="_blank"
							rel="noreferrer"
							className="text-[10px] text-muted-foreground hover:text-foreground underline shrink-0 w-[60px] text-right"
						>
							获取密钥
						</a>
					</div>
					<div className={`${rowClass} border-t border-border`}>
						<span className={fieldLabelClass}>音色 ID</span>
						<input
							value={form.tts_speaker}
							onChange={(e) => setField({ tts_speaker: e.target.value })}
							placeholder="zh_female_vv_uranus_bigtts"
							className={`${inputClass} flex-1`}
						/>
					</div>
					<div className={`${rowClass} border-t border-border`}>
						<span className={fieldLabelClass}>Resource ID</span>
						<select
							value={form.tts_resource_id}
							onChange={(e) => setField({ tts_resource_id: e.target.value })}
							className={`${selectClass} flex-1`}
						>
							{TTS_RESOURCE_IDS.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</select>
					</div>
					<div className={`${rowClass} border-t border-border`}>
						<span className={fieldLabelClass}>超时</span>
						<input
							type="number"
							min={3}
							max={30}
							value={form.tts_timeout}
							onChange={(e) => setField({ tts_timeout: Number(e.target.value) })}
							className={`${inputClass} w-20`}
						/>
						<span className="text-xs text-muted-foreground">秒</span>
						<span className="text-[10px] text-muted-foreground ml-auto">
							<a href="https://console.volcengine.com/speech/new/voices" target="_blank" rel="noreferrer" className="underline">
								音色列表
							</a>
						</span>
					</div>
				</div>

				<div className="flex justify-end">
					<Button onClick={handleSave} disabled={saveMutation.isPending}>
						{saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
						保存配置
					</Button>
				</div>

				{!config && (
					<div className="rounded-md border border-border bg-muted/20 p-2.5 text-[11px] text-muted-foreground space-y-1">
						<p className="font-medium text-foreground text-xs">接入步骤（v3 统一 API Key，非旧版 AppID+Token）</p>
						<ol className="list-decimal list-inside space-y-0.5 ml-0.5">
							<li><a href="https://console.volcengine.com/speech/new/setting/apikeys" target="_blank" rel="noreferrer" className="text-primary underline">火山引擎控制台 → API Key</a> 创建 v3 统一密钥</li>
							<li><a href="https://console.volcengine.com/speech/new/voices" target="_blank" rel="noreferrer" className="text-primary underline">音色库</a> 选择音色 ID 填入下方</li>
							<li>保存后即可使用</li>
						</ol>
					</div>
				)}

				<Separator />

				{/* ── Stream test ── */}
				<div className="space-y-2.5">
					<div className="flex items-center gap-2">
						<Volume2 size={14} className="text-muted-foreground" />
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
						placeholder="输入要合成的文本…"
						maxLength={200}
						rows={2}
						className="w-full p-2 rounded-md border border-border text-sm resize-y outline-none bg-card focus:border-primary"
					/>
					<div className="flex gap-2 items-center">
						<Button
							variant="outline"
							size="sm"
							onClick={handleStreamPlay}
							disabled={playPending || !testText.trim() || statusDot === "offline"}
						>
							{playPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Play className="size-3" />
							)}
							流式播放
						</Button>
						{playPending && (
							<Button variant="ghost" size="sm" onClick={stopPlayback}>
								<Square className="size-3" /> 停止
							</Button>
						)}
						{streamError && (
							<span className="text-[11px] text-danger/90 ml-2">{classifyError(streamError) ?? streamError}</span>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
