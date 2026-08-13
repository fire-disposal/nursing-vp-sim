import { useQuery } from "@tanstack/react-query";
import { Box, Center, Stack, Text } from "@mantine/core";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Button from "@/components/ui/button";
import { getRecordDetail, pauseTraining, resumeTraining } from "../api/training";
import { TRAINING_SCENES } from "@/components/training/scenes/scene-registry";
import { TrainingDataProvider } from "@/engine/TrainingDataContext";

export default function TrainingEntry() {
	const { recordId } = useParams<{ recordId: string }>();

	// 唯一数据查询 — 整个训练页子树共享此缓存
	const { data: record, isLoading, error, refetch } = useQuery({
		queryKey: queryKeys.training.detail(recordId ?? ""),
		queryFn: () => getRecordDetail(Number(recordId!)).then((r) => r.data),
		enabled: !!recordId,
		retry: 3,
		staleTime: 5 * 60_000,  // 5min — 信任 startTraining 返回的 session 缓存数据
	});

	// 进入训练页：恢复倒计时（离开期间服务端暂停，重进后 remaining 顺延）
	useEffect(() => {
		if (!recordId) return;
		resumeTraining(Number(recordId))
			.catch(() => {})
			.then(() => refetch());
	}, [recordId, refetch]);

	// 离开训练页：暂停倒计时（fire-and-forget）
	useEffect(() => {
		if (!recordId) return;
		return () => {
			pauseTraining(Number(recordId)).catch(() => {});
		};
	}, [recordId]);

	// 浏览器关闭/刷新：beacon 暂停（unmount 不触发）
	useEffect(() => {
		if (!recordId) return;
		const handler = () => {
			navigator.sendBeacon(`/api/training/records/${recordId}/pause`);
		};
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}, [recordId]);

	const caseId = record?.case_id ?? null;

	const {
		checkResponse,
		isLoading: qLoading,
		shouldShow: qShouldShow,
		check: qCheck,
		submit: qSubmit,
		dismiss: qDismiss,
	} = useQuestionnaire({
		caseId,
		trigger: "before_training",
	});

	useEffect(() => {
		if (caseId) qCheck();
	}, [caseId, qCheck]);

	if (!recordId) return <Text p="md">缺少训练记录 ID</Text>;
	if (isLoading) return <TrainingSkeleton />;
	if (error) {
		return (
			<Center style={{ minHeight: "60vh" }}>
				<Stack align="center" gap="sm" p="xl" ta="center">
					<Text fw={500}>加载训练记录失败</Text>
					<Text size="xs" c="dimmed" maw={384} style={{ wordBreak: "break-word" }}>
						{error instanceof Error ? error.message : String(error)}
					</Text>
					<Button variant="outline" mt={4} onClick={() => refetch()}>
						重试
					</Button>
				</Stack>
			</Center>
		);
	}
	if (!record) return <Text p="md">记录不存在</Text>;

	const type = record.training_type || "history_taking";
	const SceneComponent = TRAINING_SCENES[type];
	if (!SceneComponent) return <Text p="md">未知训练类型: {type}</Text>;

	const pendingQ = (record as { pending_questionnaires?: number }).pending_questionnaires ?? 0;

	return (
		<TrainingDataProvider value={record}>
			{qShouldShow && checkResponse && (
				<QuestionnaireModal
					open={qShouldShow}
					onComplete={() => { qCheck(); }}
					onSkip={qDismiss}
					checkResponse={checkResponse}
					loading={qLoading}
					onSubmit={qSubmit}
				/>
			)}
			{pendingQ > 0 && !qShouldShow && (
				<Box
					bg="blue.1"
					c="blue.8"
					px="md"
					py={8}
					ta="center"
					style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}
				>
					<Text size="xs">本练习包含问卷，可在训练后于「我的问卷」中完成</Text>
				</Box>
			)}
			{/* key={recordId}：切换病例时强制重挂场景子树，避免复用旧对话状态 */}
			<SceneComponent key={recordId} recordId={recordId} />
		</TrainingDataProvider>
	);
}

function TrainingSkeleton() {
	return (
		<Box style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
			<Box p="sm" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)", flexShrink: 0 }}>
				<LoadingSkeleton variant="stats" />
			</Box>
			<Box p="md" style={{ flex: 1, overflow: "hidden" }}>
				<LoadingSkeleton variant="card" />
			</Box>
		</Box>
	);
}
