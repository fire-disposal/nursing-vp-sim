import { Box, Button, Group, Loader, Stack, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type AsrStatusResponse,
	fetchVoiceConfig,
	testAsrConnection,
	updateVoiceConfig,
} from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const ASR_RESOURCE_ID = "volc.seedasr.sauc.duration";
const ASR_RESOURCE_LABEL = "流式 ASR 2.0 小时版";

function errorHint(msg: string | null): string | null {
	if (!msg) return null;
	if (msg.includes("401")) return "ASR API Key 无效或已过期";
	if (msg.includes("403")) return "未开通流式 ASR 服务";
	if (msg.includes("未配置")) return "尚未设置 ASR API Key";
	if (msg.includes("timeout") || msg.includes("超时")) return "连接超时";
	return msg.length > 100 ? `${msg.slice(0, 100)}…` : msg;
}

function StatusDot({ color }: { color: string }) {
	return <Box bg={color} mr={4} style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />;
}

/**
 * ASR 服务配置卡。
 *
 * 与 TTS 卡共用同一份 `VoiceConfig`（`queryKeys.voice.config`），但**凭据完全独立**：
 * ASR 走 `asr_api_key`，保存时只提交这一个字段——`/admin/voice/config` 是整份 PUT，
 * 多带一个 TTS 字段就把 TTS 的 Key 用空值覆盖掉了。
 */
export default function VoiceASRTokenCard() {
	const toast = useToast();
	const qc = useQueryClient();

	const { data: cfg, isLoading } = useQuery({
		queryKey: queryKeys.voice.config,
		queryFn: fetchVoiceConfig,
		staleTime: 60_000,
	});

	const [apiKey, setApiKey] = useState("");
	const [apiKeyLocked, setApiKeyLocked] = useState(true);
	const [status, setStatus] = useState<AsrStatusResponse | null>(null);
	const [checking, setChecking] = useState(false);
	const apiKeyRef = useRef<HTMLInputElement>(null);

	const doCheck = useCallback(() => {
		setChecking(true);
		testAsrConnection()
			.then(setStatus)
			.catch(() => setStatus(null))
			.finally(() => setChecking(false));
	}, []);

	const saveMut = useMutation({
		// 只发 asr_api_key：不带 provider / TTS 字段，避免整份覆盖时动到 TTS 配置
		mutationFn: (key: string) => updateVoiceConfig({ asr_api_key: key }),
		onSuccess: () => {
			toast.success("ASR 已保存");
			setApiKey("");
			setApiKeyLocked(true);
			qc.invalidateQueries({ queryKey: queryKeys.voice.config });
			doCheck();
		},
		onError: (e) => toast.apiError(e, "保存失败"),
	});

	// 配置身份一变（首屏、保存后）就重新验一次连通性
	const configId = cfg?.id;
	useEffect(() => {
		if (configId) doCheck();
	}, [configId, doCheck]);

	if (isLoading) return null;

	const online = status?.asr_online;
	const err = errorHint(status?.last_error ?? null);
	const dotColor = checking
		? "yellow-4"
		: online
			? "green-5"
			: status
				? "red-5"
				: "dimmed";

	return (
		<Card>
			<CardHeader style={{ paddingBottom: 8 }}>
				<Text fw={600} size="md" lh={1.35}>ASR 语音识别服务</Text>
			</CardHeader>

			<CardContent>
				<Stack gap="md">
					{/* ══ Status ══ */}
					<Group
						gap={16}
						wrap="wrap"
						align="center"
						bg="var(--mantine-color-default-hover)"
						style={{ borderRadius: 8, padding: "6px 12px" }}
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
								style={{ fontSize: 12, textDecoration: "underline", color: "var(--mantine-color-dimmed)" }}
							>
								刷新
							</Button>
						</Group>
						<Text size="xs" c="dimmed">
							测试连接只建立会话并发送配置帧，不发送音频
						</Text>
						{err && <Text size="xs" c="red" style={{ width: "100%" }}>{err}</Text>}
						{!err && status?.last_error_at && (
							<Text size="xs" c="dimmed" style={{ width: "100%" }}>
								最近一次错误：{new Date(status.last_error_at).toLocaleString()}
							</Text>
						)}
					</Group>

					{/* ══ Config ══ */}
					<Stack gap={0} bg="var(--mantine-color-default-hover)" style={{ borderRadius: 8, overflow: "hidden" }}>
						{/* 防浏览器密码自动填充：与 TTS 卡同样的哑输入 */}
						<input type="text" name="dummy-asr-username" autoComplete="username" style={{ display: "none" }} tabIndex={-1} />
						<input type="password" name="dummy-asr-password" autoComplete="current-password" style={{ display: "none" }} tabIndex={-1} />
						<Group gap={12} align="center" wrap="wrap" px="sm" py={10}>
							<Text size="xs" c="dimmed" fw={500} w={80} style={{ flexShrink: 0 }}>ASR Key</Text>
							<TextInput
								ref={apiKeyRef}
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder={cfg?.asr_api_key_masked || "火山引擎控制台 → ASR API Key"}
								disabled={apiKeyLocked}
								autoComplete="off"
								aria-label="ASR API Key"
								styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
								style={{ flex: "1 1 220px", minWidth: 0 }}
							/>
							<Button
								variant="subtle"
								size="xs"
								onClick={() => {
									const next = !apiKeyLocked;
									setApiKeyLocked(next);
									if (!next) setTimeout(() => apiKeyRef.current?.focus(), 0);
								}}
							>
								{apiKeyLocked ? "编辑" : "锁定"}
							</Button>
						</Group>

						<Group gap={12} align="center" wrap="wrap" px="sm" py={10} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
							<Text size="xs" c="dimmed" fw={500} w={80} style={{ flexShrink: 0 }}>资源</Text>
							<Group gap={8} wrap="wrap">
								<Text size="xs">{ASR_RESOURCE_LABEL}</Text>
								<Text size="xs" c="dimmed" ff="monospace">{status?.resource_id ?? ASR_RESOURCE_ID}</Text>
								<Text size="xs" c="dimmed">计费 1 元/小时</Text>
							</Group>
						</Group>

						<Group justify="flex-end" gap="sm" px="sm" py={8} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
							<Button
								variant="default"
								size="sm"
								onClick={doCheck}
								disabled={checking}
								leftSection={checking ? <Loader size={14} /> : null}
							>
								测试连接
							</Button>
							<Button
								onClick={() => saveMut.mutate(apiKey.trim())}
								disabled={saveMut.isPending || apiKey.trim().length === 0}
								size="sm"
							>
								{saveMut.isPending ? <Loader size={14} /> : null}
								保存 ASR Key
							</Button>
						</Group>
					</Stack>
				</Stack>
			</CardContent>
		</Card>
	);
}
