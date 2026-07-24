import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, LockOpen, Play, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { components } from "@/api/api-types.gen";
import { api } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PcmStreamPlayer } from "@/engine/tts/pcm-player";
import useAuthStore from "@/stores/authStore";

// ── API helpers (thin, type-safe) ──

type VoConfig = components["schemas"]["VoiceConfigResponse"];
type VoiceStatus = components["schemas"]["VoiceStatusResponse"];

const fetchConfig = () => api.get<VoConfig>("/admin/voice/config").then((r) => r.data);
const saveConfig = (data: Partial<components["schemas"]["VoiceConfigUpdateRequest"]>) =>
	api.put<VoConfig>("/admin/voice/config", data).then((r) => r.data);
const checkStatus = () => api.post<VoiceStatus>("/admin/voice/config/test-tts").then((r) => r.data);

async function streamFromPool(text: string, speaker: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
	const token = useAuthStore.getState().token;
	const r = await fetch("/api/admin/voice/config/test-stream", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ text, speaker }),
		signal,
	});
	if (!r.ok) {
		let msg = `HTTP ${r.status}`;
		try { const b = await r.json(); if (b?.detail) msg = String(b.detail); } catch { /* */ }
		throw new Error(msg);
	}
	if (!r.body) throw new Error("空响应体");
	return r.body;
}

// ── Helpers ──

function errorHint(msg: string | null): string | null {
	if (!msg) return null;
	if (msg.includes("401")) return "API Key 无效或已过期";
	if (msg.includes("403")) return "未开通语音服务";
	if (msg.includes("timeout") || msg.includes("超时")) return "连接超时";
	return msg.length > 100 ? `${msg.slice(0, 100)}…` : msg;
}

const dot = (c: string) => `inline-block w-2 h-2 rounded-full ${c}`;

// ── Component ──

export default function VoiceTokenCard() {
	const toast = useToast();
	const qc = useQueryClient();

	const { data: cfg, isLoading } = useQuery({
		queryKey: queryKeys.voice.config,
		queryFn: fetchConfig,
		staleTime: 60_000,
	});
	const saveMut = useMutation({
		mutationFn: saveConfig,
		onSuccess: () => {
			toast.success("已保存");
			qc.invalidateQueries({ queryKey: queryKeys.voice.config });
			doCheck();
		},
		onError: (e) => toast.apiError(e, "保存失败"),
	});

	const [apiKey, setApiKey] = useState("");
	const [apiKeyLocked, setApiKeyLocked] = useState(true);
	const [timeoutS, setTimeoutS] = useState(8);
	const [speakerLib, setSpeakerLib] = useState<Record<string, string>>({});

	const [status, setStatus] = useState<VoiceStatus | null>(null);
	const [checking, setChecking] = useState(false);

	const [testText, setTestText] = useState("你好，这是一段测试语音。");
	const [playingSlot, setPlayingSlot] = useState<string | null>(null);
	const [chunkMs, setChunkMs] = useState<number | null>(null);
	const [playError, setPlayError] = useState<string | null>(null);
	const player = useRef<PcmStreamPlayer | null>(null);
	const abortCtl = useRef<AbortController | null>(null);
	const apiKeyRef = useRef<HTMLInputElement>(null);

	// Sync form from server on load / save
	useEffect(() => {
		if (cfg) {
			setTimeoutS(cfg.tts_timeout);
			setSpeakerLib(cfg.speaker_library ?? {});
		}
	}, [cfg]);

	// Auto-verify on mount + when config identity changes
	const configId = cfg?.id;
	useEffect(() => { if (configId) doCheck(); /* eslint-disable-next-line */ }, [configId]);
	useEffect(() => () => stopPlay(), []);

	const doCheck = useCallback(() => {
		setChecking(true);
		checkStatus().then(setStatus).catch(() => setStatus(null)).finally(() => setChecking(false));
	}, []);

	const handleSave = useCallback(() => {
		saveMut.mutate({
			provider: "volcengine",
			api_key: apiKey || undefined,
			tts_timeout: timeoutS,
			speaker_library: Object.keys(speakerLib).length > 0 ? speakerLib : undefined,
		});
	}, [saveMut, apiKey, timeoutS, speakerLib]);

	const stopPlay = useCallback(() => {
		abortCtl.current?.abort();
		abortCtl.current = null;
		player.current?.stop();
		setPlayingSlot(null);
	}, []);

	const playSlot = useCallback(async (slotSpeaker: string) => {
		const t = testText.trim();
		if (!t || playingSlot) return;
		stopPlay();
		setPlayingSlot(slotSpeaker);
		setChunkMs(null);
		setPlayError(null);
		const t0 = performance.now();
		try {
			if (!player.current) player.current = new PcmStreamPlayer();
			const ac = new AbortController();
			abortCtl.current = ac;
			const body = await streamFromPool(t, slotSpeaker, ac.signal);
			await player.current.playStream(body, () => setChunkMs(Math.round(performance.now() - t0)));
		} catch (e: unknown) {
			if (abortCtl.current?.signal.aborted) return;
			setPlayError(e instanceof Error ? e.message : String(e));
		} finally {
			if (!abortCtl.current?.signal.aborted) setPlayingSlot(null);
			abortCtl.current = null;
		}
	}, [testText, playingSlot, stopPlay]);

	if (isLoading) return null;

	const online = status?.tts_online;
	const err = errorHint(status?.last_error ?? null);

	const row = "flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5";
	const labelCls = "sm:w-[80px] shrink-0 text-xs text-muted-foreground font-medium";
	const inputCls = "h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-base">TTS 语音服务</CardTitle>
			</CardHeader>

			<CardContent className="space-y-4">
				{/* ══ Status ══ */}
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/15 px-3 py-1.5 text-xs">
					{checking ? (
						<span className={`${dot("bg-amber-400")} mr-1`} />
					) : online ? (
						<span className={`${dot("bg-green-500")} mr-1`} />
					) : status ? (
						<span className={`${dot("bg-red-500")} mr-1`} />
					) : (
						<span className={`${dot("bg-gray-300")} mr-1`} />
					)}
					<span className="font-medium">
						{checking ? "检查中…" : online ? "在线" : status ? "离线" : "未知"}
					</span>
					<button type="button" onClick={doCheck} disabled={checking} className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1">
						刷新
					</button>

					{status?.tts_pool_total != null && (
						<span className="text-muted-foreground/80">
							连接池 {status.tts_pool_in_use ?? 0}/{status.tts_pool_total}（上限 {status.tts_pool_size ?? "-"}）
						</span>
					)}
					{err && <span className="w-full text-[11px] text-danger/90">{err}</span>}
				</div>

				{/* ══ Config ══ */}
				<div className="border border-border rounded-lg overflow-hidden text-sm">
					{/* API Key — dummy inputs to prevent browser password autofill */}
					<input type="text" name="dummy-username" autoComplete="username" className="hidden" tabIndex={-1} />
					<input type="password" name="dummy-password" autoComplete="current-password" className="hidden" tabIndex={-1} />
					<div className={row}>
						<span className={labelCls}>API Key</span>
						<div className="flex-1 relative min-w-0 flex items-center gap-2">
							<input
								ref={apiKeyRef}
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder={cfg?.api_key_masked || "火山引擎控制台 → API Key"}
								className={`${inputCls} font-mono flex-1`}
								autoComplete="off"
								disabled={apiKeyLocked}
							/>
							<button
								type="button"
								onClick={() => {
									const next = !apiKeyLocked;
									setApiKeyLocked(next);
									if (!next) setTimeout(() => apiKeyRef.current?.focus(), 0);
								}}
								className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
								title={apiKeyLocked ? "解除锁定" : "锁定"}
							>
								{apiKeyLocked ? <Lock size={14} /> : <LockOpen size={14} />}
							</button>
						</div>
					</div>

					{/* Timeout */}
					<div className={`${row} border-t border-border/50`}>
						<span className={labelCls}>超时</span>
						<div className="flex items-center gap-2">
							<input
								type="number" min={3} max={30} value={timeoutS}
								onChange={(e) => setTimeoutS(Number(e.target.value))}
								className={`${inputCls} w-14`}
							/>
							<span className="text-[11px] text-muted-foreground">秒</span>
						</div>
					</div>

					{/* Save footer */}
					<div className="border-t border-border/50 px-3 py-2 flex justify-end">
						<Button onClick={handleSave} disabled={saveMut.isPending} size="sm">
							{saveMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
							保存配置
						</Button>
					</div>
				</div>

				{/* ══ Speaker library ══ */}
				<div className="border border-border rounded-lg overflow-hidden text-sm">
					<div className="px-3 py-2 bg-muted/30 border-b border-border/50 flex items-center justify-between">
						<span className="text-xs font-medium">音色映射（按患者人口自动选择发音人）</span>
						<a href="https://console.volcengine.com/speech/new/voices" target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground underline">音色库 →</a>
					</div>
					<div className="divide-y divide-border/30">
						{[
							["child_male", "男童"], ["child_female", "女童"],
							["male_young", "青年男"], ["male_middle", "中年男"], ["male_elder", "老年男"],
							["female_young", "青年女"], ["female_middle", "中年女"], ["female_elder", "老年女"],
							["fallback", "默认"],
						].map(([key, label]) => {
							const slotSpeaker = speakerLib[key] || "zh_female_vv_uranus_bigtts";
							const isPlaying = playingSlot === key;
							return (
								<div key={key} className="flex items-center gap-2 px-3 py-2">
									<span className="text-xs text-muted-foreground w-12 shrink-0 text-right">{label}</span>
									<input
										value={speakerLib[key] ?? ""}
										onChange={(e) => setSpeakerLib((prev) => ({ ...prev, [key]: e.target.value }))}
										placeholder="zh_female_vv_uranus_bigtts"
										className="h-7 flex-1 min-w-0 rounded border border-border bg-background px-2 text-[11px] font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									/>
									<button
										type="button"
										onClick={() => isPlaying ? stopPlay() : playSlot(slotSpeaker)}
										disabled={playingSlot !== null && !isPlaying}
										className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
										title={isPlaying ? "停止" : "试听"}
									>
										{isPlaying ? <Square size={14} /> : <Play size={14} />}
									</button>
								</div>
							);
						})}
					</div>
					<div className="border-t border-border/50 px-3 py-2 flex justify-end">
						<Button onClick={handleSave} disabled={saveMut.isPending} size="sm">
							{saveMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
							保存配置
						</Button>
					</div>
				</div>

				{!cfg && (
					<div className="rounded-md border border-border bg-muted/15 p-2.5 text-[11px] text-muted-foreground">
						首次使用 → <a href="https://console.volcengine.com/speech/new/setting/apikeys" target="_blank" rel="noreferrer" className="text-primary underline">火山引擎控制台</a> 创建 v3 统一 API Key，填入保存。
					</div>
				)}

				<Separator />

				{/* ══ Stream test ══ */}
				<div className="space-y-2">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Volume2 size={13} />
						试听文本（点击各槽位 ▶ 按钮播放）
						{chunkMs !== null && <span className="text-[11px]">首块 <span className="text-foreground font-medium">{chunkMs}ms</span></span>}
						{playError && <span className="text-[11px] text-danger/90 truncate max-w-[160px]">{errorHint(playError) ?? playError}</span>}
					</div>
					<textarea value={testText} onChange={(e) => setTestText(e.target.value)} maxLength={200} rows={2} className="w-full p-2 rounded-md border border-border text-sm resize-y outline-none bg-card focus:border-primary" />
				</div>
			</CardContent>
		</Card>
	);
}
