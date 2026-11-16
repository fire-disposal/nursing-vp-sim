import { Box } from "@mantine/core";
import { useEffect, useRef } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { TrainingUnavailable, trainingUnavailableCopy } from "@/components/training/TrainingUnavailable";
import { ActivityRail } from "@/components/training/workspace/ActivityRail";
import { TrainingEngine } from "@/engine/TrainingEngine";
import { probeViewportGap } from "@/utils/viewport";

export default function HistoryTakingScene({ recordId }: { recordId: string }) {
  // 高度走 .training-immersive：dvh 不支持时由 CSS 兜到 100vh（旧内核会整条丢弃 100dvh）。
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    probeViewportGap(rootRef.current);
  }, []);
  return (
		<Box
			ref={rootRef}
			className="training-immersive"
			style={{
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
				paddingTop: "env(safe-area-inset-top, 0px)",
			}}
		>
			<ErrorBoundary
				fallback={
					// 训练页没有 App 导航：崩溃态也必须保留出口，否则学生只能靠浏览器后退
					<TrainingUnavailable
						{...trainingUnavailableCopy.renderCrashed}
						onRetry={() => window.location.reload()}
					/>
				}
			>
				<TrainingEngine recordId={recordId}>
					<ActivityRail />
				</TrainingEngine>
			</ErrorBoundary>
		</Box>
  );
}
