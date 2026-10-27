import { Box } from "@mantine/core";
import ErrorBoundary from "@/components/ErrorBoundary";
import { TrainingUnavailable } from "@/components/training/TrainingUnavailable";
import { ActivityRail } from "@/components/training/workspace/ActivityRail";
import { TrainingEngine } from "@/engine/TrainingEngine";

export default function HistoryTakingScene({ recordId }: { recordId: string }) {
  return (
		<Box
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100dvh",
				overflow: "hidden",
				paddingTop: "env(safe-area-inset-top, 0px)",
			}}
		>
			<ErrorBoundary
				fallback={
					// 训练页没有 App 导航：崩溃态也必须保留出口，否则学生只能靠浏览器后退
					<TrainingUnavailable
						title="训练加载失败"
						detail="工作区渲染出错，请重试或返回。"
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
