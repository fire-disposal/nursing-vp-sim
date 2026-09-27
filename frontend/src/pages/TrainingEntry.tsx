import { useQuery } from "@tanstack/react-query";
import { Box, Button, Center, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { getRecordDetail, pauseTraining, pauseTrainingOnHide, resumeTraining } from "../api/training";
import { TRAINING_SCENES } from "@/components/training/scenes/scene-registry";
import { TrainingDataProvider } from "@/engine/TrainingDataContext";
import { parseSessionManifest } from "@/engine/manifest";

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
		staleTime: 5 * 60_000,
		// 训练进行中每 15s 轻量轮询：感知服务端状态变更（他端结束、remaining 校准）。
		// 安全前提：trainingStore.init 幂等守卫保证轮询 refetch 不会冲掉会话内消息。
		refetchInterval: (query) =>
			query.state.data?.status === "in_progress" ? 15_000 : false,
	});

	// 进入训练页：恢复引导/盲盒暂停时间；独立考核由服务端保持连续计时。
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

	// 页面关闭/刷新/进入 bfcache：服务端按模式决定暂停，且会结束问卷专用暂停。
	// 必须是**带 Authorization 的 keepalive 请求** —— 旧实现的 navigator.sendBeacon 无法
	// 附加请求头，服务端 401，从未真正暂停；而且此处无法向正在卸载的页面回报结果，
	// 因此不承诺任何状态（页面已离开，UI 也不该显示「已暂停」——重进时以服务端 detail 为准）。
	useEffect(() => {
		if (!recordId || !mode) return;
		const handler = (event: PageTransitionEvent) => {
			if (event.persisted) return; // 进 bfcache：页面未真正离开，训练仍在继续
			void pauseTrainingOnHide(recordId).catch(() => {
				/* 页面正在卸载：无法提示，也不谎称已暂停（服务端 detail 才是真值） */
			});
		};
		window.addEventListener("pagehide", handler);
		return () => window.removeEventListener("pagehide", handler);
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

	// 工作区由服务端 manifest 的 workflow 决定
	const manifest = parseSessionManifest(record.manifest);
	// 首帧可能来自 startTraining 的轻量 session 缓存（不含 manifest）：继续等完整详情
	if (!manifest) return <TrainingSkeleton />;

	const SceneComponent = TRAINING_SCENES[manifest.workflow.id];
	if (!SceneComponent) {
		return (
			<Center style={{ minHeight: "60vh" }}>
				<Stack align="center" gap="sm" p="xl" ta="center">
					<Text fw={500}>该训练工作区尚未在此版本提供</Text>
					<Text size="xs" c="dimmed">
						工作区：{manifest.workflow.label || manifest.workflow.id}
					</Text>
					<Button variant="outline" mt={4} onClick={() => refetch()}>
						重新加载
					</Button>
				</Stack>
			</Center>
		);
	}

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
			<Box p="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)", flexShrink: 0 }}>
				<LoadingSkeleton variant="stats" />
			</Box>
			<Box p="md" style={{ flex: 1, overflow: "hidden" }}>
				<LoadingSkeleton variant="card" />
			</Box>
		</Box>
	);
}
