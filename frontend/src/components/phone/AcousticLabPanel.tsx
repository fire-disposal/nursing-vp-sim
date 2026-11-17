import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";
import { IconActivity, IconPlayerStop, IconRefresh } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { MicCapture, type EchoCalibrationResult } from "@/engine/audio/mic";
import { PcmStreamPlayer } from "@/engine/tts/pcm-player";

/** 独立声学工作面板：不开 LLM，只验证扬声器→麦克风的实际匹配。 */
export default function AcousticLabPanel() {
	const [result, setResult] = useState<EchoCalibrationResult | null>(null);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const playerRef = useRef<PcmStreamPlayer | null>(null);
	const captureRef = useRef<MicCapture | null>(null);
	const runRef = useRef(0);

	const stop = () => {
		runRef.current += 1;
		setRunning(false);
		void captureRef.current?.close();
		captureRef.current = null;
		playerRef.current?.dispose();
		playerRef.current = null;
	};

	useEffect(() => () => {
		void captureRef.current?.close();
		playerRef.current?.dispose();
	}, []);

	const start = async () => {
		stop();
		const run = runRef.current;
		setResult(null);
		setError(null);
		setRunning(true);
		try {
			const player = new PcmStreamPlayer();
			playerRef.current = player;
			await player.prime();
			captureRef.current = await MicCapture.open({
				echoLevel: () => player.outputLevel(),
				onEchoCalibration: (next) => {
					if (runRef.current !== run) return;
					setResult(next);
					setRunning(false);
				},
			});
			await player.playConnectTone();
		} catch (err) {
			if (runRef.current !== run) return;
			setRunning(false);
			setError((err as Error)?.message ?? "麦克风不可用");
		}
	};

	return (
		<Card withBorder radius="md" padding="md" data-testid="acoustic-lab">
			<Stack gap="sm">
				<Group justify="space-between" wrap="wrap">
					<Stack gap={2}>
						<Text fw={600}>声学工作面板</Text>
						<Text size="sm" c="dimmed">独立检查三音符匹配，不启动对话。</Text>
					</Stack>
					<Badge color={result?.status === "success" ? "green" : result?.status === "failed" || error ? "red" : running ? "yellow" : "gray"}>
						{result?.status === "success" ? `匹配成功 ${result.delayMs}ms` : result?.status === "failed" || error ? "匹配失败" : running ? "校准中" : "未校准"}
					</Badge>
				</Group>
				<Group gap="xs">
					<Button size="xs" leftSection={<IconRefresh size={14} />} onClick={() => void start()} loading={running}>
						开始校准
					</Button>
					<Button size="xs" variant="subtle" color="gray" leftSection={<IconPlayerStop size={14} />} onClick={stop} disabled={!running && !result && !error}>
						停止
					</Button>
				</Group>
				{result && (
					<Text size="sm" c="dimmed">
						延迟 {result.delayMs}ms；增益 {result.gain?.toFixed(3) ?? "—"}；相关度 {result.score?.toFixed(2) ?? "稳定电平"}
					</Text>
				)}
				{error && <Text size="sm" c="red">无法完成校准：{error}</Text>}
				{!result && !error && (
					<Group gap={6}>
						<IconActivity size={15} />
						<Text size="xs" c="dimmed">点击开始后保持安静，直到徽章显示结果。</Text>
					</Group>
				)}
			</Stack>
		</Card>
	);
}
