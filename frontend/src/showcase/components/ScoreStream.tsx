import { Badge, Box, Group, Loader, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCircleCheck } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

const SCORE_ITEMS = [
	"→ 加载评分标准 v3.2 ...",
	"→ 匹配 Rubric: 护理沟通能力量表",
	"→ 解析对话轮次：共 18 轮",
	"→ 识别有效沟通 14 轮（77.8%）",
	"→ 开放性问题 5 个，闭合性 12 个",
	"→ 检查共情表达模式...",
	"→ 第 3 轮：自我介绍 ✓ 得分",
	"→ 第 4 轮：开放提问 ✓ 得分",
	"→ 第 6 轮：闭合提问偏多 ⚠",
	"→ 第 8 轮：共情回应 '我理解' ✓",
	"→ 第 9-11 轮：缺少共情 ⚠",
	"→ 第 12 轮：追问家族史 ✓ 得分",
	"→ 第 14 轮：过渡衔接自然 ✓",
	"→ 第 16 轮：患者防御情绪检测...",
	"→ 现病史覆盖：5/5 ✓",
	"→ 既往史覆盖：3/3 ✓",
	"→ 家族史覆盖：1/3 ⚠ 缺失",
	"→ 过敏史覆盖：3/3 ✓",
	"→ 生成 19 维度评估报告...",
];

const FEEDBACK_ITEMS = [
	"+ 共采集 5 个核心病史维度，完整性优秀",
	"+ 问诊开场结构清晰，建立了良好信任关系",
	"+ 在患者提及家族病史时及时追问，捕捉关键信息",
	"- 闭合性问题占比偏高（12/17），建议增加开放提问",
	"- 第 4-6 轮缺少共情回应，可能导致患者防御情绪",
	"- 未询问患者心理状态与情绪变化",
];

function useLoopingQueue(items: string[], active: boolean, baseDelay = 800) {
	const [lines, setLines] = useState<string[]>([]);
	const idxRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const activeRef = useRef(active);
	activeRef.current = active;

	const tick = useCallback(() => {
		if (!activeRef.current) return;
		setLines((prev) => {
			const next = [...prev, items[idxRef.current]];
			idxRef.current = (idxRef.current + 1) % items.length;
			if (prev.length > 20) return next.slice(-16);
			return next;
		});
		const jitter = baseDelay * (0.4 + Math.random() * 1.2);
		timerRef.current = setTimeout(tick, jitter);
	}, [items, baseDelay]);

	useEffect(() => {
		if (active) {
			setLines([]);
			idxRef.current = 0;
			timerRef.current = setTimeout(tick, 400);
		}
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [active, tick]);

	return lines;
}

export default function ScoreStream() {
	const [phase, setPhase] = useState<"scoring" | "feedback" | "complete">("scoring");
	const [percentage, setPercentage] = useState(0);
	const phaseRef = useRef(phase);
	phaseRef.current = phase;
	const cycleRef = useRef(0);

	useEffect(() => {
		const run = () => {
			cycleRef.current += 1;
			const cyc = cycleRef.current;
			setPercentage(0);
			setPhase("scoring");

			const pTimer = setInterval(() => {
				setPercentage((p) => {
					if (p < 40) return p + 1;
					if (p < 80) return p + 0.5;
					if (p < 99) return p + 0.2;
					return p;
				});
			}, 350);

			const t1 = setTimeout(() => { if (cycleRef.current === cyc) setPhase("feedback"); }, 5000);
			const t2 = setTimeout(() => { if (cycleRef.current === cyc) setPhase("complete"); }, 11000);
			const t3 = setTimeout(() => {
				if (cycleRef.current === cyc) {
					clearInterval(pTimer);
					run();
				}
			}, 14000);

			return () => {
				clearInterval(pTimer);
				clearTimeout(t1);
				clearTimeout(t2);
				clearTimeout(t3);
			};
		};

		const cleanup = run();
		return cleanup;
	}, []);

	const scoreLines = useLoopingQueue(SCORE_ITEMS, phase === "scoring", 900);
	const feedbackLines = useLoopingQueue(FEEDBACK_ITEMS, phase !== "scoring", 1400);

	const scoreProgress = phase === "complete" ? 100 : Math.round(percentage);

	return (
		<Paper
			withBorder
			radius="md"
			p="lg"
			pos="relative"
			style={{ minHeight: 460, display: "flex", flexDirection: "column", overflow: "hidden" }}
		>
			<Group justify="space-between" gap="md" pos="relative" style={{ zIndex: 10 }}>
				<Stack gap={4}>
					<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
						流式评分
					</Text>
					<Text size="lg" fw={700}>
						AI 思考 · 逐项证据回传
					</Text>
				</Stack>
				<Badge variant="default" radius="xl" leftSection={<Box w={6} h={6} style={{ borderRadius: "50%", background: phase === "complete" ? "var(--mantine-color-green-6)" : "var(--mantine-primary-color-6)" }} />}>
					SSE live
				</Badge>
			</Group>

			<Group gap={12} mt="lg" pos="relative" style={{ zIndex: 10 }} wrap="nowrap">
				<ThemeIcon
					size={32}
					radius="md"
					variant="light"
					color={phase === "complete" ? "green" : undefined}
					style={{ flexShrink: 0 }}
				>
					{phase !== "complete" ? (
						<Loader size={14} type="dots" />
					) : (
						<IconCircleCheck size={14} />
					)}
				</ThemeIcon>
				<Box style={{ minWidth: 0, flex: 1 }}>
					<Group justify="space-between" gap={8}>
						<Text size="sm" fw={600}>
							{phase !== "complete" ? "正在评估训练表现" : "评估完成"}
						</Text>
						<Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
							{scoreProgress}%
						</Text>
					</Group>
					<Box
						mt={6}
						h={6}
						style={{
							width: "100%",
							borderRadius: "9999px",
							background: "var(--mantine-color-gray-2)",
							overflow: "hidden",
						}}
					>
						<Box
							h="100%"
							style={{
								width: `${Math.max(4, scoreProgress)}%`,
								borderRadius: "9999px",
								transition: "all 500ms ease-out",
								background:
									phase === "complete"
										? "var(--mantine-color-green-6)"
										: "var(--mantine-primary-color-6)",
							}}
						/>
					</Box>
				</Box>
			</Group>

			<Group
				gap={8}
				mt="md"
				align="stretch"
				pos="relative"
				style={{ zIndex: 10, flex: 1, minHeight: 0 }}
			>
				<Box
					style={{
						flex: 1,
						display: "flex",
						flexDirection: "column",
						border: "1px solid var(--mantine-color-default-border)",
						borderRadius: "var(--mantine-radius-sm)",
						background: "var(--mantine-color-gray-0)",
						padding: "6px 8px",
						overflow: "hidden",
					}}
				>
					<Text size="xs" c="var(--mantine-primary-color-6)" mb={4} style={{ fontFamily: "var(--mantine-font-family-monospace)", flexShrink: 0 }}>
						$ scoring_dimensions
					</Text>
					<Box style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
						{scoreLines.map((item, i) => (
							<Text key={`${i}-${item.slice(0, 12)}`} size="xs" c="dimmed" lh={1.6} py={2} style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
								{item}
							</Text>
						))}
						{scoreLines.length === 0 && (
							<Text size="xs" c="dimmed" opacity={0.5}>
								▎ 初始化中...
							</Text>
						)}
					</Box>
				</Box>

				<Box
					style={{
						flex: 1,
						display: "flex",
						flexDirection: "column",
						border: "1px solid var(--mantine-color-default-border)",
						borderRadius: "var(--mantine-radius-sm)",
						background: "var(--mantine-color-gray-0)",
						padding: "6px 8px",
						overflow: "hidden",
					}}
				>
					<Text size="xs" c="var(--mantine-primary-color-6)" mb={4} style={{ fontFamily: "var(--mantine-font-family-monospace)", flexShrink: 0 }}>
						$ feedback_generation
					</Text>
					<Box style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
						{feedbackLines.map((item, i) => (
							<Text key={`${i}-${item.slice(0, 12)}`} size="xs" c="dimmed" lh={1.6} py={2} style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
								{item}
							</Text>
						))}
						{feedbackLines.length === 0 && (
							<Text size="xs" c="dimmed" opacity={0.5}>
								等待评分完成...
							</Text>
						)}
					</Box>
				</Box>
			</Group>
		</Paper>
	);
}
