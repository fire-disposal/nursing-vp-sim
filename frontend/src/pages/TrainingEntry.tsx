import { useQuery } from "@tanstack/react-query";
import { Box, Button, Center, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { getRecordDetail, pauseTraining, resumeTraining } from "../api/training";
import { TRAINING_SCENES } from "@/components/training/scenes/scene-registry";
import { TrainingDataProvider } from "@/engine/TrainingDataContext";

export default function TrainingEntry() {
	const { recordId } = useParams<{ recordId: string }>();
	const [sessionReady, setSessionReady] = useState(false);
	const questionnairePauseActiveRef = useRef(false);
	const questionnairePauseRequestRef = useRef<Promise<unknown> | null>(null);

	// 唯一数据查询 — 整个训练页子树共享此缓存
	const { data: record, isLoading, error, refetch } = useQuery({
		queryKey: queryKeys.training.detail(recordId ?? ""),
		queryFn: () => getRecordDetail(Number(recordId!)).then((r) => r.data),
		enabled: !!recordId,
		retry: 3,
		staleTime: 5 * 60_000,  // 5min — 信任 startTraining 返回的 session 缓存数据
		// 训练进行中每 15s 轻量轮询：感知服务端状态变更（他端结束、remaining 校准）。
		// 安全前提：trainingStore.init 幂等守卫保证轮询 refetch 不会冲掉会话内消息。
		refetchInterval: (query) =>
			query.state.data?.status === "in_progress" ? 15_000 : false,
	});

	// 进入训练页：恢复引导/盲盒暂停时间；独立考核由服务端保持连续计时。
	// 随后重取完整详情，避免 startTraining 的轻量 session 缺字段。
	useEffect(() => {
		if (!recordId) return;
		questionnairePauseActiveRef.current = false;
		setSessionReady(false);
		resumeTraining(Number(recordId))
			.catch(() => {})
			.finally(() => {
				setSessionReady(true);
				void refetch();
			});
	}, [recordId, refetch]);

	const mode = record?.mode;
	useEffect(() => {
		if (!recordId || !mode) return;
		return () => {
			const pendingQuestionnairePause =
				questionnairePauseRequestRef.current?.catch(() => {});
			void (pendingQuestionnairePause ?? Promise.resolve()).then(() =>
				pauseTraining(Number(recordId)),
			);
		};
	}, [mode, recordId]);

	// 浏览器关闭/刷新：服务端按模式决定暂停，且会结束问卷专用暂停。
	useEffect(() => {
		if (!recordId || !mode) return;
		const handler = () => {
			navigator.sendBeacon(`/api/training/records/${recordId}/pause`);
		};
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}, [mode, recordId]);

	const caseId = record?.case_id ?? null;

	const {
		checkResponse,
		hasChecked: qHasChecked,
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
		if (caseId && sessionReady) void qCheck();
	}, [caseId, qCheck, sessionReady]);
	useEffect(() => {
		if (!recordId) return;
		const requiredQuestionnaireOpen =
			qShouldShow && checkResponse?.is_required === true;
		if (requiredQuestionnaireOpen && !questionnairePauseActiveRef.current) {
			questionnairePauseActiveRef.current = true;
			const request = pauseTraining(Number(recordId), { questionnaire: true });
			questionnairePauseRequestRef.current = request;
			void request
				.catch(() => {
					questionnairePauseActiveRef.current = false;
				})
				.finally(() => {
					if (questionnairePauseRequestRef.current === request) {
						questionnairePauseRequestRef.current = null;
					}
				});
		} else if (!requiredQuestionnaireOpen && questionnairePauseActiveRef.current) {
			questionnairePauseActiveRef.current = false;
			const pendingQuestionnairePause =
				questionnairePauseRequestRef.current?.catch(() => {});
			void (pendingQuestionnairePause ?? Promise.resolve()).then(() =>
				resumeTraining(Number(recordId)),
			);
		}
	}, [checkResponse?.is_required, qShouldShow, recordId]);

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
	if (!qHasChecked) return <TrainingSkeleton />;

	const type = record.training_type || "history_taking";
	const SceneComponent = TRAINING_SCENES[type];
	if (!SceneComponent) return <Text p="md">未知训练类型: {type}</Text>;

	const requiredQuestionnaireOpen = qShouldShow && checkResponse?.is_required === true;

	return (
		<TrainingDataProvider value={record}>
			{qShouldShow && checkResponse && (
				<QuestionnaireModal
					key={checkResponse.template_id}
					open={qShouldShow}
					onComplete={() => { void qCheck(); }}
					onSkip={qDismiss}
					checkResponse={checkResponse}
					loading={qLoading}
					onSubmit={qSubmit}
				/>
			)}
			{!requiredQuestionnaireOpen && (
				<SceneComponent key={recordId} recordId={recordId} />
			)}
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
