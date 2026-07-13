/**
 * SceneToolbar — 移动端场景工具按钮栏
 *
 * 渲染在 ChatInput 上方，隐藏于桌面端（md:hidden）。
 * 点击图标打开对应的 Bottomsheet 面板。
 */
import { Suspense, useCallback, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import Bottomsheet from "@/components/ui/Bottomsheet";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import type { SceneCardProps } from "@/engine/scene-card";
import type { SceneCard } from "@/engine/scene-card";
import { useTrainingContext } from "@/engine/TrainingContext";
import { SceneStateProvider } from "@/engine/useSceneBus";
import { getSceneCards } from "./scene-cards/registry";

const ICONS: Record<string, string> = {
	"patient-info": "👤",
	inquiry: "📋",
	monitor: "💓",
	"body-exam": "🩺",
	notes: "📝",
	mews: "📊",
};

const TITLES: Record<string, string> = {
	"patient-info": "患者信息",
	inquiry: "问诊指引",
	monitor: "生命体征",
	"body-exam": "护理查体",
	"nursing-record": "护理记录",
	notes: "备忘笔记",
	mews: "MEWS 评分",
};

export default function SceneToolbar() {
	const { bus, features, trainingType, recordId } = useTrainingContext();
	const cards: SceneCard[] = getSceneCards(trainingType, features);
	const [activeId, setActiveId] = useState<string | null>(null);

	const activeCard = cards.find((c) => c.id === activeId);
	const cardProps: SceneCardProps = { bus, mode: "training" as const, recordId };

	const handleClose = useCallback(() => setActiveId(null), []);

	if (cards.length === 0) return null;

	return (
		<>
			{/* Horizontal icon toolbar — placed above chat input on mobile */}
			<div className="flex items-center gap-1 px-2 py-1.5 border-t border-border bg-card shrink-0 md:hidden overflow-x-auto">
				{cards.map((card) => {
					const isActive = card.id === activeId;
					const cap = card.featureFlag ? ALL_CAPABILITIES[card.featureFlag] : null;
					return (
						<button
							key={card.id}
							onClick={() => setActiveId(isActive ? null : card.id)}
							className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 text-xs"
							title={cap?.label ?? card.id}
							style={isActive ? { borderColor: "var(--color-primary)", background: "var(--color-primary-10)" } : {}}
						>
							<span>{ICONS[card.id] ?? "◻"}</span>
							<span>{TITLES[card.id] ?? card.id}</span>
						</button>
					);
				})}
			</div>

			{/* Bottomsheet panel */}
			{activeCard && (
				<Bottomsheet open onClose={handleClose} title={TITLES[activeCard.id] ?? activeCard.id}>
					<Suspense fallback={<div className="h-20" />}>
						<SceneStateProvider bus={bus}>
							<ErrorBoundary
								fallback={
									<div className="flex flex-col items-center gap-2 p-4 text-sm text-muted-foreground">
										<span>卡片加载失败</span>
									</div>
								}
							>
								<activeCard.component {...cardProps} />
							</ErrorBoundary>
						</SceneStateProvider>
					</Suspense>
				</Bottomsheet>
			)}
		</>
	);
}
