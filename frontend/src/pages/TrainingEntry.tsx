import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
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

	if (!recordId) return <div>缺少训练记录 ID</div>;
	if (isLoading) return <TrainingSkeleton />;
	if (error) {
		return (
			<div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
				<div className="text-base font-medium">加载训练记录失败</div>
				<div className="max-w-sm text-xs text-muted-foreground/70 break-words">
					{error instanceof Error ? error.message : String(error)}
				</div>
				<button
					onClick={() => refetch()}
					className="mt-1 rounded-lg border border-border bg-card px-4 py-1.5 text-sm transition-colors hover:bg-muted"
				>
					重试
				</button>
			</div>
		);
	}
	if (!record) return <div>记录不存在</div>;

	const type = record.training_type || "history_taking";
	const SceneComponent = TRAINING_SCENES[type];
	if (!SceneComponent) return <div>未知训练类型: {type}</div>;

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
				<div className="bg-info/10 text-info-foreground text-xs px-4 py-2 text-center border-b border-border">
					本练习包含问卷，可在训练后于「我的问卷」中完成
				</div>
			)}
			{/* key={recordId}：切换病例时强制重挂场景子树，避免复用旧对话状态 */}
			<SceneComponent key={recordId} recordId={recordId} />
		</TrainingDataProvider>
	);
}

function TrainingSkeleton() {
	return (
		<div className="flex flex-col h-screen" style={{ height: "100dvh" }}>
			<div className="p-3 border-b shrink-0">
				<LoadingSkeleton variant="stats" />
			</div>
			<div className="flex-1 p-4 overflow-hidden">
				<LoadingSkeleton variant="card" />
			</div>
		</div>
	);
}
