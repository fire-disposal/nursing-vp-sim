import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { MessageBus, ScoreData, ScoreDimension } from "@/engine/types";
import { cn } from "@/utils/cn";

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

	const ringClass =
		percentage >= 80 ? "text-success-foreground" : percentage >= 60 ? "text-warning-foreground" : "text-destructive";

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
					stroke="currentColor"
					strokeWidth="8"
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={offset}
					className={cn("transition-all duration-1000 ease-out", ringClass)}
				/>
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center">
				<span className={cn("text-3xl font-bold", ringClass)}>
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
	const dimMax = Number.isFinite(dimension.max) && dimension.max > 0 ? dimension.max : dimension.items?.reduce((s, i) => s + (Number.isFinite(i.max) && i.max > 0 ? i.max : 3), 0) ?? 100;
	const percentage = dimMax > 0 ? (dimension.score / dimMax) * 100 : 0;
	const barColor =
		percentage >= 80 ? "bg-success" : percentage >= 60 ? "bg-warning" : "bg-destructive";

	useEffect(() => {
		const raf = requestAnimationFrame(() => setBarWidth(`${percentage}%`));
		return () => cancelAnimationFrame(raf);
	}, [percentage]);

	return (
		<div className="rounded-lg border p-3">
			<div className="mb-1.5 flex items-center justify-between">
				<span className="text-sm font-medium">{name}</span>
				<span className="text-xs tabular-nums text-muted-foreground">
					<span className="font-semibold text-foreground">{dimension.score}</span>/{dimMax}
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
					{dimension.items.map((item, i) => {
						const itemMax = Number.isFinite(item.max) && item.max > 0 ? item.max : 3;
						return (
							<div key={i} className="flex justify-between text-xs text-muted-foreground ml-1">
								<span>{item.name || `项目 ${i + 1}`}</span>
								<span className="tabular-nums">
									{item.score}/{itemMax}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
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
							<h3 className="mb-1.5 text-sm font-medium text-success-foreground flex items-center gap-1.5">
								<span className="inline-block size-1.5 rounded-full bg-success" />
								优势
							</h3>
							<ul className="space-y-1">
								{score.strengths.map((s, i) => (
									<li key={i} className="text-sm text-muted-foreground flex gap-2">
										<span className="mt-0.5 inline-block size-1 shrink-0 rounded-full bg-success/60" />
										{s}
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Weaknesses */}
					{score.weaknesses && score.weaknesses.length > 0 && (
						<div>
							<h3 className="mb-1.5 text-sm font-medium text-warning-foreground flex items-center gap-1.5">
								<span className="inline-block size-1.5 rounded-full bg-warning" />
								改进建议
							</h3>
							<ul className="space-y-1">
								{score.weaknesses.map((w, i) => (
									<li key={i} className="text-sm text-muted-foreground flex gap-2">
										<span className="mt-0.5 inline-block size-1 shrink-0 rounded-full bg-warning/60" />
										{w}
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Missed Content */}
					{score.missed_content && score.missed_content.length > 0 && (
						<div>
							<h3 className="mb-1.5 text-sm font-medium text-destructive flex items-center gap-1.5">
								<span className="inline-block size-1.5 rounded-full bg-destructive" />
								遗漏要点
							</h3>
							<ul className="space-y-1">
								{score.missed_content.map((m, i) => (
									<li key={i} className="text-sm text-muted-foreground flex gap-2">
										<span className="mt-0.5 inline-block size-1 shrink-0 rounded-full bg-destructive/60" />
										{m}
									</li>
								))}
							</ul>
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
		navigate("/home");
	};

	return <ScoreCardInner score={score} onClose={handleClose} onRestart={handleRestart} />;
}
