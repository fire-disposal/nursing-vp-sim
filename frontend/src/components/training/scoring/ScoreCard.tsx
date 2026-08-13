import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Group, Stack, Text } from "@mantine/core";
import Button from "@/components/ui/button";
import { CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { MessageBus, ScoreData, ScoreDimension } from "@/engine/types";

// ── Circular Progress Ring ──

function CircularProgress({ score, maxScore }: { score: number; maxScore: number }) {
	const radius = 52;
	const circumference = 2 * Math.PI * radius;
	const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
	const [offset, setOffset] = useState(circumference);

	useEffect(() => {
		const raf = requestAnimationFrame(() =>
			setOffset(circumference * (1 - Math.min(percentage, 100) / 100)),
		);
		return () => cancelAnimationFrame(raf);
	}, [percentage, circumference]);

	const ringColor =
		percentage >= 80
			? "var(--mantine-color-green-6)"
			: percentage >= 60
				? "var(--mantine-color-gray-6)"
				: "var(--mantine-color-red-6)";

	return (
		<Box style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
			<svg
				width="140"
				height="140"
				viewBox="0 0 120 120"
				style={{ transform: "rotate(-90deg)" }}
				role="img"
				aria-label={`得分 ${score}/${maxScore}`}
			>
				<circle
					cx="60"
					cy="60"
					r={radius}
					fill="none"
					stroke="var(--mantine-color-gray-3)"
					strokeWidth="8"
				/>
				<circle
					cx="60"
					cy="60"
					r={radius}
					fill="none"
					stroke={ringColor}
					strokeWidth="8"
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={offset}
					style={{ transition: "all 1000ms ease-out" }}
				/>
			</svg>
			<Box style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
				<Text fw={700} style={{ fontSize: 30, color: ringColor }}>
					{score}
				</Text>
				<Text size="xs" c="dimmed">/ {maxScore}</Text>
			</Box>
		</Box>
	);
}

// ── Dimension Section ──

function DimensionSection({ name, dimension }: { name: string; dimension: ScoreDimension }) {
	const [barWidth, setBarWidth] = useState("0%");
	const dimMax = Number.isFinite(dimension.max) && dimension.max > 0 ? dimension.max : dimension.items?.reduce((s, i) => s + (Number.isFinite(i.max) && i.max > 0 ? i.max : 3), 0) ?? 100;
	const percentage = dimMax > 0 ? (dimension.score / dimMax) * 100 : 0;
	const barColor =
		percentage >= 80
			? "var(--mantine-color-green-6)"
			: percentage >= 60
				? "var(--mantine-color-gray-6)"
				: "var(--mantine-color-red-6)";

	useEffect(() => {
		const raf = requestAnimationFrame(() => setBarWidth(`${percentage}%`));
		return () => cancelAnimationFrame(raf);
	}, [percentage]);

	return (
		<Box p="sm" style={{ borderRadius: 8, border: "1px solid var(--mantine-color-default-border)" }}>
			<Group justify="space-between" mb={6} wrap="nowrap">
				<Text size="sm" fw={500}>{name}</Text>
				<Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
					<Text component="span" fw={600} c="var(--mantine-color-text)">{dimension.score}</Text>/{dimMax}
				</Text>
			</Group>
			<Box h={8} w="100%" style={{ borderRadius: 999, background: "var(--mantine-color-gray-2)", overflow: "hidden" }}>
				<Box
					h="100%"
					style={{ width: barWidth, borderRadius: 999, transition: "all 700ms ease-out", background: barColor }}
				/>
			</Box>
			{dimension.items && dimension.items.length > 0 && (
				<Box mt={8}>
					{dimension.items.map((item, i) => {
						const itemMax = Number.isFinite(item.max) && item.max > 0 ? item.max : 3;
						return (
							<Group key={i} justify="space-between" wrap="nowrap" ml={4}>
								<Text size="xs" c="dimmed">{item.name || `项目 ${i + 1}`}</Text>
								<Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
									{item.score}/{itemMax}
								</Text>
							</Group>
						);
					})}
				</Box>
			)}
		</Box>
	);
}

// ── Inner Component ──

export interface ScoreCardInnerProps {
	score: ScoreData;
	onClose: () => void;
	onRestart?: () => void;
}

export function ScoreCardInner({ score, onClose, onRestart }: ScoreCardInnerProps) {
	const handleClose = () => onClose();

	const handleRestart = () => onRestart?.();

	const totalMax = useMemo(() => {
		const sumOfDimMax = score.detail_scores
			? Object.values(score.detail_scores).reduce((sum, d) => sum + (d.max || 0), 0)
			: 0;
		const denom = Math.max(sumOfDimMax, score.total_score || 0) || 100;
		return denom;
	}, [score.detail_scores, score.total_score]);

	return (
		<Dialog open onOpenChange={(o) => !o && handleClose()}>
			<DialogContent maxWidth={448}>
				<CardHeader>
					<CardTitle>训练评分报告</CardTitle>
				</CardHeader>

				<CardContent>
					<Stack gap="xl">
						{/* Total Score — Ring */}
						{score.total_score !== undefined && (
							<Group justify="center">
								<CircularProgress score={score.total_score} maxScore={totalMax} />
							</Group>
						)}

						{/* Dimensions */}
						{score.detail_scores && Object.keys(score.detail_scores).length > 0 && (
							<Stack gap="md">
								<Text size="xs" fw={500} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
									评分维度
								</Text>
								{Object.entries(score.detail_scores).map(([dimName, dim]) => (
									<DimensionSection key={dimName} name={dimName} dimension={dim} />
								))}
							</Stack>
						)}

						{/* Strengths */}
						{score.strengths && score.strengths.length > 0 && (
							<Box>
								<Group gap={6} mb={6} wrap="nowrap">
									<Box w={6} h={6} style={{ borderRadius: 999, background: "var(--mantine-color-green-6)" }} />
									<Text size="sm" fw={500} c="green.6">优势</Text>
								</Group>
								<Stack gap={4}>
									{score.strengths.map((s, i) => (
										<Group key={i} gap={8} align="flex-start" wrap="nowrap">
											<Box w={4} h={4} mt={6} style={{ borderRadius: 999, background: "var(--mantine-color-green-4)", flexShrink: 0 }} />
											<Text size="sm" c="dimmed">{s}</Text>
										</Group>
									))}
								</Stack>
							</Box>
						)}

						{/* Weaknesses */}
						{score.weaknesses && score.weaknesses.length > 0 && (
							<Box>
								<Group gap={6} mb={6} wrap="nowrap">
									<Box w={6} h={6} style={{ borderRadius: 999, background: "var(--mantine-color-yellow-6)" }} />
									<Text size="sm" fw={500} c="yellow.7">改进建议</Text>
								</Group>
								<Stack gap={4}>
									{score.weaknesses.map((w, i) => (
										<Group key={i} gap={8} align="flex-start" wrap="nowrap">
											<Box w={4} h={4} mt={6} style={{ borderRadius: 999, background: "var(--mantine-color-yellow-4)", flexShrink: 0 }} />
											<Text size="sm" c="dimmed">{w}</Text>
										</Group>
									))}
								</Stack>
							</Box>
						)}

						{/* Missed Content */}
						{score.missed_content && score.missed_content.length > 0 && (
							<Box>
								<Group gap={6} mb={6} wrap="nowrap">
									<Box w={6} h={6} style={{ borderRadius: 999, background: "var(--mantine-color-red-6)" }} />
									<Text size="sm" fw={500} c="red.6">遗漏要点</Text>
								</Group>
								<Stack gap={4}>
									{score.missed_content.map((m, i) => (
										<Group key={i} gap={8} align="flex-start" wrap="nowrap">
											<Box w={4} h={4} mt={6} style={{ borderRadius: 999, background: "var(--mantine-color-red-4)", flexShrink: 0 }} />
											<Text size="sm" c="dimmed">{m}</Text>
										</Group>
									))}
								</Stack>
							</Box>
						)}

						{/* Suggestions */}
						{score.suggestions && (
							<Box p="sm" style={{ borderRadius: 8, background: "var(--mantine-color-gray-1)" }}>
								<Text size="sm" fw={500} mb={4}>学习建议</Text>
								<Text size="sm" c="dimmed" lh={1.6}>{score.suggestions}</Text>
							</Box>
						)}
					</Stack>
				</CardContent>

				<CardFooter>
					<Group gap={8} grow>
						<Button variant="default" onClick={handleClose}>
							{onRestart ? "返回记录" : "关闭"}
						</Button>
						{onRestart && (
							<Button variant="secondary" onClick={handleRestart}>
								重新开始
							</Button>
						)}
					</Group>
				</CardFooter>
			</DialogContent>
		</Dialog>
	);
}

// ── Entry Point ──

export function ScoreCard({
	bus,
	recordId,
}: {
	bus: MessageBus;
	recordId: string;
}) {
	const navigate = useNavigate();

	useEffect(() => {
		const unsub = bus.on("score:ready", () => {
			// Brief pause so the user sees the completion state in ScoringOverlay
			setTimeout(() => {
				navigate(`/record/${recordId}`, { replace: true });
			}, 1500);
		});
		return unsub;
	}, [bus, recordId, navigate]);

	return null;
}
