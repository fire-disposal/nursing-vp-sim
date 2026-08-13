import { Box, Stack, Text } from "@mantine/core";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SceneRenderer } from "@/components/training/SceneRenderer";
import { TrainingEngine } from "@/engine";

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
					<Stack align="center" justify="center" gap={12} p="xl" h="100%" ta="center" c="dimmed">
						<Text size="sm" fw={500}>训练加载失败</Text>
						<Text size="xs">请返回重试或刷新页面</Text>
					</Stack>
				}
			>
				<TrainingEngine recordId={recordId}>
					<SceneRenderer />
				</TrainingEngine>
			</ErrorBoundary>
		</Box>
  );
}
