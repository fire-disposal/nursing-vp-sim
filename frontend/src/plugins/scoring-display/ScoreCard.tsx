// frontend/src/plugins/scoring-display/ScoreCard.tsx
import { useEffect, useState } from "react";
import type {
	MessageBus,
	ScoreData,
	ScoreDimension,
	ScoreDimensionItem,
} from "@/engine/types";

interface ScoreCardInnerProps {
	score: ScoreData;
	onClose: () => void;
}

function DetailItem({
	name,
	item,
}: {
	name: string;
	item: ScoreDimensionItem;
}) {
	return (
		<div className="flex justify-between text-xs text-muted-foreground ml-4">
			<span>{item.name || name}</span>
			<span className="tabular-nums">
				{item.score}/{item.max}
			</span>
		</div>
	);
}

export function ScoreCardInner({ score, onClose }: ScoreCardInnerProps) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-md max-h-[80vh] overflow-auto rounded-lg bg-background p-6 shadow-lg">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-xl font-bold">训练评分报告</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground"
					>
						✕
					</button>
				</div>

				{score.total_score !== undefined && (
					<div className="mb-4 text-center">
						<span className="text-4xl font-bold text-primary">
							{score.total_score}
						</span>
						<span className="text-muted-foreground"> 分</span>
					</div>
				)}

				{score.detail_scores && (
					<div className="mb-4 space-y-2">
						<h3 className="text-sm font-medium text-muted-foreground">
							详细评分
						</h3>
						{Object.entries(score.detail_scores).map(([dimName, dim]) => {
							const dimension = dim as ScoreDimension;
							return (
								<div
									key={dimName}
									className="rounded border border-border bg-card p-2"
								>
									<div className="flex justify-between text-sm">
										<span className="font-medium">{dimName}</span>
										<span className="tabular-nums">
											{dimension.score}/{dimension.max}
										</span>
									</div>
									{dimension.items?.map((item, i) => (
										<DetailItem key={i} name={`item_${i}`} item={item} />
									))}
								</div>
							);
						})}
					</div>
				)}

				{score.strengths?.length ? (
					<div className="mb-3">
						<h3 className="text-sm font-medium text-green-600">优势</h3>
						<ul className="list-inside list-disc text-sm">
							{score.strengths.map((s, i) => (
								<li key={i}>{s}</li>
							))}
						</ul>
					</div>
				) : null}

				{score.weaknesses?.length ? (
					<div className="mb-3">
						<h3 className="text-sm font-medium text-red-600">改进建议</h3>
						<ul className="list-inside list-disc text-sm">
							{score.weaknesses.map((w, i) => (
								<li key={i}>{w}</li>
							))}
						</ul>
					</div>
				) : null}

				{score.summary && (
					<div className="mb-4 rounded bg-muted p-3 text-sm">
						<h3 className="mb-1 font-medium">总结</h3>
						<p>{score.summary}</p>
					</div>
				)}

				{score.missed_content?.length ? (
					<div className="mb-3">
						<h3 className="text-sm font-medium text-orange-600">遗漏要点</h3>
						<ul className="list-inside list-disc text-sm">
							{score.missed_content.map((m, i) => (
								<li key={i}>{m}</li>
							))}
						</ul>
					</div>
				) : null}

				{score.suggestions && (
					<div className="mb-4 rounded bg-muted p-3 text-sm">
						<h3 className="mb-1 font-medium">学习建议</h3>
						<p>{score.suggestions}</p>
					</div>
				)}

				<button
					type="button"
					onClick={onClose}
					className="w-full rounded bg-primary py-2 text-sm text-primary-foreground"
				>
					返回
				</button>
			</div>
		</div>
	);
}

export function ScoreCard({
	bus,
	recordId,
}: {
	bus: MessageBus;
	recordId: string;
}) {
	const [score, setScore] = useState<ScoreData | null>(null);

	useEffect(() => {
		const unsub = bus.on("score:ready", (data: ScoreData) => {
			setScore(data);
		});
		return unsub;
	}, [bus]);

	if (!score) return null;

	const handleClose = () => {
		setScore(null);
		window.location.href = `/record/${recordId}`;
	};

	return <ScoreCardInner score={score} onClose={handleClose} />;
}
