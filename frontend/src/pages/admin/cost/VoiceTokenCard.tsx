import { ActionIcon, Box, Button, Group, Loader, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLock, IconLockOpen, IconPlayerPlay, IconPlayerStop, IconVolume2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { components } from "@/api/api-types.gen";
import { api } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
		const msg = await r.text().catch(() => "");
		throw new Error(msg || `HTTP ${r.status}`);
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

function StatusDot({ color }: { color: string }) {
	return <Box bg={color} mr={4} style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />;
}

const SPEAKER_SLOTS: [string, string][] = [
	["child_male", "男童"], ["child_female", "女童"],
	["male_young", "青年男"], ["male_middle", "中年男"], ["male_elder", "老年男"],
	["female_young", "青年女"], ["female_middle", "中年女"], ["female_elder", "老年女"],
	["fallback", "默认"],
];

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

	const dotColor = checking
		? "yellow.4"
		: online
			? "green.5"
			: status
				? "red.5"
				: "gray.3";

	return (
		<Card>
			<CardHeader style={{ paddingBottom: 8 }}>
				<Text fw={600} size="md" lh={1.35}>TTS 语音服务</Text>
			</CardHeader>

			<CardContent>
				<Stack gap="md">
					{/* ══ Status ══ */}
					<Group
						gap={16}
						wrap="wrap"
						align="center"
						style={{
							border: "1px solid var(--mantine-color-default-border)",
							borderRadius: 8,
							padding: "6px 12px",
						}}
					>
						<Group gap={4} align="center" wrap="nowrap">
							<StatusDot color={`var(--mantine-color-${dotColor})`} />
							<Text size="xs" fw={500}>
								{checking ? "检查中…" : online ? "在线" : status ? "离线" : "未知"}
							</Text>
							<Button
								variant="transparent"
								size="xs"
								onClick={doCheck}
								disabled={checking}
								style={{ fontSize: 10, textDecoration: "underline", color: "var(--mantine-color-dimmed)" }}
							>
								刷新
							</Button>
						</Group>

						{status?.tts_pool_total != null && (
							<Text size="xs" c="dimmed">
								连接池 {status.tts_pool_in_use ?? 0}/{status.tts_pool_total}（上限 {status.tts_pool_size ?? "-"}）
							</Text>
						)}
						{err && <Text size="xs" c="red" style={{ width: "100%" }}>{err}</Text>}
					</Group>

					{/* ══ Config ══ */}
					<Stack gap={0} style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, overflow: "hidden" }}>
						{/* API Key — dummy inputs to prevent browser password autofill */}
						<input type="text" name="dummy-username" autoComplete="username" style={{ display: "none" }} tabIndex={-1} />
						<input type="password" name="dummy-password" autoComplete="current-password" style={{ display: "none" }} tabIndex={-1} />
						<Group gap={12} align="center" wrap="wrap" px="sm" py={10}>
							<Text size="xs" c="dimmed" fw={500} w={80} style={{ flexShrink: 0 }}>API Key</Text>
							<TextInput
								ref={apiKeyRef}
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder={cfg?.api_key_masked || "火山引擎控制台 → API Key"}
								disabled={apiKeyLocked}
								autoComplete="off"
								styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
								style={{ flex: "1 1 220px", minWidth: 0 }}
								rightSection={
									<ActionIcon
										variant="subtle"
										color="gray"
										onClick={() => {
											const next = !apiKeyLocked;
											setApiKeyLocked(next);
											if (!next) setTimeout(() => apiKeyRef.current?.focus(), 0);
										}}
										title={apiKeyLocked ? "解除锁定" : "锁定"}
									>
										{apiKeyLocked ? <IconLock size={14} /> : <IconLockOpen size={14} />}
									</ActionIcon>
								}
							/>
						</Group>

						{/* Timeout */}
						<Group gap={12} align="center" wrap="nowrap" px="sm" py={10} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
							<Text size="xs" c="dimmed" fw={500} w={80} style={{ flexShrink: 0 }}>超时</Text>
							<Group gap={8} align="center">
								<NumberInput
									value={timeoutS}
									onChange={(v) => setTimeoutS(Number(v))}
									min={3}
									max={30}
									w={60}
								/>
								<Text size="xs" c="dimmed">秒</Text>
							</Group>
						</Group>

						{/* Save footer */}
						<Group justify="flex-end" px="sm" py={8} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
							<Button onClick={handleSave} disabled={saveMut.isPending} size="sm">
								{saveMut.isPending ? <Loader size={14} /> : null}
								保存配置
							</Button>
						</Group>
					</Stack>

					{/* ══ Speaker library ══ */}
					<Stack gap={0} style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, overflow: "hidden" }}>
						<Group justify="space-between" align="center" wrap="wrap" px="sm" py={8} bg="var(--mantine-color-gray-1)" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
							<Text size="xs" fw={500}>音色映射（按患者人口自动选择发音人）</Text>
							<a href="https://console.volcengine.com/speech/new/voices" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--mantine-color-dimmed)" }}>音色库 →</a>
						</Group>
						<Stack gap={0}>
							{SPEAKER_SLOTS.map(([key, label]) => {
								const slotSpeaker = speakerLib[key] || "zh_female_vv_uranus_bigtts";
								const isPlaying = playingSlot === key;
								return (
									<Group key={key} gap={8} align="center" wrap="nowrap" px="sm" py={8} style={{ borderTop: "1px solid var(--mantine-color-gray-2)" }}>
										<Text size="xs" c="dimmed" w={48} ta="right" style={{ flexShrink: 0 }}>{label}</Text>
										<TextInput
											value={speakerLib[key] ?? ""}
											onChange={(e) => setSpeakerLib((prev) => ({ ...prev, [key]: e.target.value }))}
											placeholder="zh_female_vv_uranus_bigtts"
											size="xs"
											style={{ flex: 1, minWidth: 0 }}
											styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 11 } }}
											rightSection={
												<ActionIcon
													variant="subtle"
													color="gray"
													onClick={() => (isPlaying ? stopPlay() : playSlot(slotSpeaker))}
													disabled={playingSlot !== null && !isPlaying}
													title={isPlaying ? "停止" : "试听"}
												>
													{isPlaying ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}
												</ActionIcon>
											}
										/>
									</Group>
								);
							})}
						</Stack>
						<Group justify="flex-end" px="sm" py={8} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
							<Button onClick={handleSave} disabled={saveMut.isPending} size="sm">
								{saveMut.isPending ? <Loader size={14} /> : null}
								保存配置
							</Button>
						</Group>
					</Stack>

					{!cfg && (
						<Text size="xs" c="dimmed" p={10} style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, background: "var(--mantine-color-gray-0)" }}>
							首次使用 →{" "}
							<a href="https://console.volcengine.com/speech/new/setting/apikeys" target="_blank" rel="noreferrer" style={{ color: "var(--mantine-color-teal-6)" }}>
								火山引擎控制台
							</a>{" "}
							创建 v3 统一 API Key，填入保存。
						</Text>
					)}

					<Separator />

					{/* ══ Stream test ══ */}
					<Stack gap={8}>
						<Group gap={8} align="center" wrap="wrap">
							<IconVolume2 size={13} style={{ color: "var(--mantine-color-dimmed)" }} />
							<Text size="xs" c="dimmed">试听文本（点击各槽位 ▶ 按钮播放）</Text>
							{chunkMs !== null && (
								<Text size="xs" c="dimmed">
									首块 <Text component="span" fw={500} c="default" inherit>{chunkMs}ms</Text>
								</Text>
							)}
							{playError && (
								<Text size="xs" c="red" truncate style={{ maxWidth: 160 }}>
									{errorHint(playError) ?? playError}
								</Text>
							)}
						</Group>
						<textarea
							value={testText}
							onChange={(e) => setTestText(e.target.value)}
							maxLength={200}
							rows={2}
							style={{
								width: "100%",
								padding: 8,
								borderRadius: 8,
								border: "1px solid var(--mantine-color-default-border)",
								fontSize: 14,
								resize: "vertical",
								background: "transparent",
								color: "inherit",
							}}
						/>
					</Stack>
				</Stack>
			</CardContent>
		</Card>
	);
}
