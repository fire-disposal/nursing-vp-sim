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
import type { SceneCard, SceneCardProps } from "@/engine/scene-card";
import { useTrainingContext } from "@/engine/TrainingContext";
import { SceneStateProvider } from "@/engine/useSceneBus";
import { useExamBridge } from "@/hooks/useExamBridge";
import { getSceneCards, CARD_META } from "./scene-cards/registry";

export default function SceneToolbar() {
	const { bus, features, trainingType, recordId, recordDetail } = useTrainingContext();
	const cards: SceneCard[] = getSceneCards(trainingType, features);
	const [activeId, setActiveId] = useState<string | null>(null);

	const activeCard = cards.find((c) => c.id === activeId);
	const cardProps: SceneCardProps = { bus, recordId, recordDetail };

  const handleClose = useCallback(() => setActiveId(null), []);

  useExamBridge(bus);

	if (cards.length === 0) return null;

	return (
		<>
			{/* Horizontal icon toolbar — placed above chat input on mobile */}
			<div className="flex items-center gap-1 px-1.5 py-1 border-t border-border bg-card shrink-0 md:hidden overflow-x-auto">
				{cards.map((card) => {
					const isActive = card.id === activeId;
					const cap = card.featureFlag ? ALL_CAPABILITIES[card.featureFlag] : null;
					return (
						<button
							key={card.id}
							onClick={() => setActiveId(isActive ? null : card.id)}
							className="flex items-center gap-1 px-2 h-9 rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 text-xs"
							title={cap?.label ?? card.id}
							style={isActive ? { borderColor: "var(--color-primary)", background: "var(--color-primary-10)" } : {}}
						>
              <span>{CARD_META[card.id]?.icon ?? "◻"}</span>
							<span className="hidden sm:inline">{CARD_META[card.id]?.title ?? card.id}</span>
						</button>
					);
				})}
			</div>

			{/* Bottomsheet panel */}
			{activeCard && (
				<Bottomsheet open onClose={handleClose} title={CARD_META[activeCard.id]?.title ?? activeCard.id}>
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
