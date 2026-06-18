import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { MessageBus, ScoreData, ScoreDimension } from "@/engine/types";
import { cn } from "@/lib/utils";

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

	const strokeColor =
		percentage >= 80 ? "#22c55e" : percentage >= 60 ? "#f59e0b" : "#ef4444";

	return (
		<div className="relative inline-flex items-center justify-center">
			<svg
				width="140"
				height="140"
				viewBox="0 0 120 120"
				className="-rotate-90"
				role="img"
				aria-label={`得分 ${score}/${maxScore}`}
			>
				<circle
					cx="60"
					cy="60"
					r={radius}
					fill="none"
					stroke="currentColor"
					strokeWidth="8"
					className="text-muted"
				/>
				<circle
					cx="60"
					cy="60"
					r={radius}
					fill="none"
					stroke={strokeColor}
					strokeWidth="8"
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={offset}
					className="transition-all duration-1000 ease-out"
				/>
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center">
				<span className="text-3xl font-bold" style={{ color: strokeColor }}>
					{score}
				</span>
				<span className="text-xs text-muted-foreground">/ {maxScore}</span>
			</div>
		</div>
	);
}

// ── Dimension Section ──

function DimensionSection({ name, dimension }: { name: string; dimension: ScoreDimension }) {
	const [barWidth, setBarWidth] = useState("0%");
	const percentage = dimension.max > 0 ? (dimension.score / dimension.max) * 100 : 0;
	const barColor =
		percentage >= 80 ? "bg-green-500" : percentage >= 60 ? "bg-amber-500" : "bg-red-500";

	useEffect(() => {
		const raf = requestAnimationFrame(() => setBarWidth(`${percentage}%`));
		return () => cancelAnimationFrame(raf);
	}, [percentage]);

	return (
		<div className="rounded-lg border p-3">
			<div className="mb-1.5 flex items-center justify-between">
				<span className="text-sm font-medium">{name}</span>
				<span className="text-xs tabular-nums text-muted-foreground">
					<span className="font-semibold text-foreground">{dimension.score}</span>/{dimension.max}
				</span>
			</div>
			<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
				<div
					className={cn("h-full rounded-full transition-all duration-700 ease-out", barColor)}
					style={{ width: barWidth }}
				/>
			</div>
			{dimension.items && dimension.items.length > 0 && (
				<div className="mt-2 space-y-1">
					{dimension.items.map((item, i) => (
						<div key={i} className="flex justify-between text-xs text-muted-foreground ml-1">
							<span>{item.name || `项目 ${i + 1}`}</span>
							<span className="tabular-nums">
								{item.score}/{item.max}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── Inner Component ──

interface ScoreCardInnerProps {
	score: ScoreData;
	onClose: () => void;
	onRestart?: () => void;
}

export function ScoreCardInner({ score, onClose, onRestart }: ScoreCardInnerProps) {
	const [closing, setClosing] = useState(false);

	const handleClose = () => {
		setClosing(true);
		setTimeout(onClose, 200);
	};

	const handleRestart = () => {
		setClosing(true);
		setTimeout(() => onRestart?.(), 200);
	};

	const totalMax = useMemo(() => {
		if (!score.detail_scores) return 100;
		const dims = Object.values(score.detail_scores);
		if (dims.length === 0) return 100;
		return dims.reduce((sum, d) => sum + d.max, 0);
	}, [score.detail_scores]);

	return (
		<div className="fixed inset-0 isolate z-50 flex items-center justify-center">
			<div
				className={cn(
					"absolute inset-0 bg-black/50 transition-opacity duration-200",
					closing ? "opacity-0" : "opacity-100",
				)}
			/>
			<Card
				size="sm"
				className={cn(
					"relative z-10 mx-4 w-full max-w-md max-h-[80vh] overflow-auto shadow-xl",
					!closing && "animate-in fade-in-0 zoom-in-95",
					closing && "animate-out fade-out-0 zoom-out-95",
					"duration-200",
				)}
			>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle>训练评分报告</CardTitle>
						<button
							type="button"
							onClick={handleClose}
							className="text-muted-foreground hover:text-foreground transition-colors"
						>
							✕
						</button>
					</div>
				</CardHeader>

				<CardContent className="space-y-5">
					{/* Total Score — Ring */}
					{score.total_score !== undefined && (
						<div className="flex justify-center">
							<CircularProgress score={score.total_score} maxScore={totalMax} />
						</div>
					)}

					{/* Dimensions */}
					{score.detail_scores && Object.keys(score.detail_scores).length > 0 && (
						<div className="space-y-3">
							<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								评分维度
							</h3>
							{Object.entries(score.detail_scores).map(([dimName, dim]) => (
								<DimensionSection key={dimName} name={dimName} dimension={dim} />
							))}
						</div>
					)}

					{/* Strengths */}
					{score.strengths && score.strengths.length > 0 && (
						<div>
							<h3 className="mb-1.5 text-sm font-medium text-green-600 flex items-center gap-1.5">
								<span className="inline-block size-1.5 rounded-full bg-green-500" />
								优势
							</h3>
							<ul className="space-y-1">
								{score.strengths.map((s, i) => (
									<li key={i} className="text-sm text-muted-foreground flex gap-2">
										<span className="mt-0.5 inline-block size-1 shrink-0 rounded-full bg-green-400" />
										{s}
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Weaknesses */}
					{score.weaknesses && score.weaknesses.length > 0 && (
						<div>
							<h3 className="mb-1.5 text-sm font-medium text-amber-600 flex items-center gap-1.5">
								<span className="inline-block size-1.5 rounded-full bg-amber-500" />
								改进建议
							</h3>
							<ul className="space-y-1">
								{score.weaknesses.map((w, i) => (
									<li key={i} className="text-sm text-muted-foreground flex gap-2">
										<span className="mt-0.5 inline-block size-1 shrink-0 rounded-full bg-amber-400" />
										{w}
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Missed Content */}
					{score.missed_content && score.missed_content.length > 0 && (
						<div>
							<h3 className="mb-1.5 text-sm font-medium text-orange-600 flex items-center gap-1.5">
								<span className="inline-block size-1.5 rounded-full bg-orange-500" />
								遗漏要点
							</h3>
							<ul className="space-y-1">
								{score.missed_content.map((m, i) => (
									<li key={i} className="text-sm text-muted-foreground flex gap-2">
										<span className="mt-0.5 inline-block size-1 shrink-0 rounded-full bg-orange-400" />
										{m}
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Summary */}
					{score.summary && (
						<div className="rounded-lg bg-muted p-3">
							<h3 className="mb-1 text-sm font-medium">总结</h3>
							<p className="text-sm text-muted-foreground leading-relaxed">{score.summary}</p>
						</div>
					)}

					{/* Suggestions */}
					{score.suggestions && (
						<div className="rounded-lg bg-muted p-3">
							<h3 className="mb-1 text-sm font-medium">学习建议</h3>
							<p className="text-sm text-muted-foreground leading-relaxed">{score.suggestions}</p>
						</div>
					)}
				</CardContent>

				<CardFooter className="gap-2">
					<button
						type="button"
						onClick={handleClose}
						className={cn(
							"rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity",
							onRestart ? "flex-1" : "w-full",
						)}
					>
						{onRestart ? "返回记录" : "关闭"}
					</button>
					{onRestart && (
						<button
							type="button"
							onClick={handleRestart}
							className="flex-1 rounded-lg bg-secondary py-2 text-sm font-medium text-secondary-foreground hover:opacity-90 transition-opacity"
						>
							重新开始
						</button>
					)}
				</CardFooter>
			</Card>
		</div>
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
	const [score, setScore] = useState<ScoreData | null>(null);

	useEffect(() => {
		const unsub = bus.on("score:ready", (data: ScoreData) => {
			setScore(data);
		});
		return unsub;
	}, [bus]);

	if (!score) return null;

	const handleClose = () => {
		navigate(`/record/${recordId}`);
	};

	const handleRestart = () => {
		navigate("/cases");
	};

	return <ScoreCardInner score={score} onClose={handleClose} onRestart={handleRestart} />;
}
